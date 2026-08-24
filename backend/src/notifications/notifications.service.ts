import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrderStatus, OrderType, PushPlatform } from '@prisma/client';
import {
  App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { Lang, pick } from '../i18n/lang';

const FIREBASE_APP_NAME = 'pizzburg-notifications';
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

export interface OrderStatusNotification {
  title: string;
  body: string;
}

export function orderStatusNotification(
  orderNumber: number,
  status: OrderStatus,
  type: OrderType,
  lang: Lang = 'ru',
): OrderStatusNotification {
  const ru: Record<OrderStatus, string> = {
    NEW: 'Отправлен на кухню',
    ACCEPTED: 'Принят рестораном',
    COOKING: 'Уже готовится',
    READY: type === 'PICKUP' ? 'Готов к выдаче' : 'Готов и скоро отправится к вам',
    ON_WAY: 'Курьер уже в пути',
    DELIVERED: type === 'PICKUP' ? 'Выдан. Спасибо за заказ!' : 'Доставлен. Приятного аппетита!',
    CANCELLED: 'Отменён',
  };
  const kk: Record<OrderStatus, string> = {
    NEW: 'Асханаға жіберілді',
    ACCEPTED: 'Мейрамхана қабылдады',
    COOKING: 'Дайындалып жатыр',
    READY: type === 'PICKUP' ? 'Беруге дайын' : 'Дайын, жақында жолға шығады',
    ON_WAY: 'Курьер жолда',
    DELIVERED:
      type === 'PICKUP' ? 'Берілді. Тапсырысыңызға рақмет!' : 'Жеткізілді. Ас болсын!',
    CANCELLED: 'Тоқтатылды',
  };
  return {
    title: pick(lang, `Заказ №${orderNumber}`, `№${orderNumber} тапсырыс`),
    body: pick(lang, ru[status], kk[status]),
  };
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private messaging?: Messaging;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.FCM_ENABLED === '0') {
      this.logger.log('FCM отключён через FCM_ENABLED=0');
      return;
    }

    try {
      const app = this.firebaseApp();
      if (!app) {
        this.logger.log(
          'FCM не настроен: добавьте FIREBASE_SERVICE_ACCOUNT_JSON или GOOGLE_APPLICATION_CREDENTIALS',
        );
        return;
      }
      this.messaging = getMessaging(app);
      this.logger.log('FCM готов к отправке уведомлений');
    } catch (error) {
      // Отсутствующая или ошибочная конфигурация уведомлений не должна
      // останавливать приём заказов.
      this.logger.error(`FCM не запущен: ${this.errorMessage(error)}`);
    }
  }

  async registerDevice(
    customerId: string,
    input: {
      token: string;
      platform: PushPlatform;
      appVersion?: string;
      lang?: Lang;
    },
  ) {
    await this.prisma.pushDevice.upsert({
      where: { token: input.token },
      create: {
        customerId,
        token: input.token,
        platform: input.platform,
        appVersion: input.appVersion,
        lang: input.lang ?? 'ru',
      },
      update: {
        customerId,
        platform: input.platform,
        appVersion: input.appVersion,
        lang: input.lang ?? 'ru',
        isEnabled: true,
        lastSeenAt: new Date(),
      },
    });
    return { registered: true };
  }

  async unregisterDevice(customerId: string, token: string) {
    await this.prisma.pushDevice.updateMany({
      where: { customerId, token },
      data: { isEnabled: false, lastSeenAt: new Date() },
    });
    return { registered: false };
  }

  /**
   * Уведомление является побочным каналом: ошибка Firebase логируется, но
   * никогда не откатывает уже сохранённый статус заказа или операции баллов.
   */
  async sendOrderStatus(orderId: string, status: OrderStatus) {
    const messaging = this.messaging;
    if (!messaging) return;

    try {
      await this.deliverOrderStatus(messaging, orderId, status);
    } catch (error) {
      this.logger.warn(
        `FCM для заказа ${orderId} не отправлен: ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * Уведомление о заказе, не связанное со сменой статуса.
   *
   * Нужно для нехватки позиции (DECISIONS §12.9): статус заказа при этом
   * не меняется — основной отдел уже готовит, — а сказать человеку надо
   * срочно, у него пять минут на ответ. Отдельный `type` в данных, а не
   * `order_status`: приложение должно открыть экран с выбором, а не
   * просто обновить шкалу.
   */
  async sendOrderEvent(
    orderId: string,
    /// Строим текст по языку устройства, а не один на всех: у клиента
    /// может быть два телефона на разных языках (DECISIONS §12.30).
    notification:
      | OrderStatusNotification
      | ((lang: Lang) => OrderStatusNotification),
    data: Record<string, string> = {},
  ) {
    const messaging = this.messaging;
    if (!messaging) return;

    try {
      await this.deliverToCustomer(
        messaging,
        orderId,
        typeof notification === 'function' ? notification : () => notification,
        data,
      );
    } catch (error) {
      this.logger.warn(
        `FCM для заказа ${orderId} не отправлен: ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * Уведомление клиенту, не привязанное к заказу.
   *
   * Нужно для ручного начисления баллов (DECISIONS §12.29): когда кассир
   * начисляет компенсацию вместо возврата денег, человек об этом узнаёт
   * только если сам зайдёт в приложение — а смысл компенсации в том,
   * чтобы он о ней узнал. Отдельный `type`, чтобы приложение открыло
   * баллы, а не экран заказа.
   */
  async sendToCustomer(
    customerId: string,
    build: (lang: Lang) => OrderStatusNotification,
    data: Record<string, string> = {},
  ) {
    const messaging = this.messaging;
    if (!messaging) return { sent: 0 };

    try {
      const devices = await this.prisma.pushDevice.findMany({
        where: { customerId, isEnabled: true },
        select: { token: true, lang: true },
      });
      const byToken = new Map<string, Lang>();
      for (const d of devices) {
        byToken.set(d.token, d.lang === 'kk' ? 'kk' : 'ru');
      }
      const tokens = [...byToken.keys()];
      if (tokens.length === 0) return { sent: 0 };

      // Устройств у человека единицы, поэтому шлём по одному: разбивать
      // на языковые пачки ради двух телефонов незачем.
      const response = await messaging.sendEach(
        tokens.map((token) => ({
          token,
          notification: build(byToken.get(token)!),
          data,
          android: {
            priority: 'high' as const,
            notification: { channelId: 'news', sound: 'default' },
          },
          apns: { payload: { aps: { sound: 'default' } } },
        })),
      );

      const invalid = response.responses.flatMap((result, index) => {
        const code = result.error?.code;
        return code && INVALID_TOKEN_CODES.has(code) ? [tokens[index]] : [];
      });
      if (invalid.length > 0) {
        await this.prisma.pushDevice.updateMany({
          where: { token: { in: invalid } },
          data: { isEnabled: false },
        });
      }
      return { sent: response.successCount };
    } catch (error) {
      this.logger.warn(
        `Уведомление клиенту ${customerId} не отправлено: ${this.errorMessage(error)}`,
      );
      return { sent: 0 };
    }
  }

  /**
   * Рассылка сообщения ленты всем устройствам.
   *
   * Возвращает, скольким устройствам ушло: владелец должен видеть охват,
   * а не гадать, дошла ли акция хоть до кого-то. Мёртвые токены гасятся
   * так же, как в статусах заказа.
   */
  async broadcast(messageId: string, title: string, body: string) {
    const messaging = this.messaging;
    if (!messaging) return { sent: 0, configured: false };

    const devices = await this.prisma.pushDevice.findMany({
      where: { isEnabled: true },
      select: { token: true },
    });
    const tokens = [...new Set(devices.map((d) => d.token))];
    let sent = 0;

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title, body },
          data: { type: 'message', messageId },
          android: {
            priority: 'high',
            notification: { channelId: 'news', sound: 'default' },
          },
          apns: { payload: { aps: { sound: 'default' } } },
        });
        sent += response.successCount;

        const invalid = response.responses.flatMap((result, index) => {
          const code = result.error?.code;
          return code && INVALID_TOKEN_CODES.has(code) ? [batch[index]] : [];
        });
        if (invalid.length > 0) {
          await this.prisma.pushDevice.updateMany({
            where: { token: { in: invalid } },
            data: { isEnabled: false },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Рассылка ${messageId}: пачка не ушла: ${this.errorMessage(error)}`,
        );
      }
    }
    return { sent, configured: true };
  }

  private async deliverOrderStatus(
    messaging: Messaging,
    orderId: string,
    status: OrderStatus,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { number: true, type: true },
    });
    if (!order) return;
    await this.deliverToCustomer(
      messaging,
      orderId,
      (lang) => orderStatusNotification(order.number, status, order.type, lang),
      { type: 'order_status', status },
    );
  }

  private async deliverToCustomer(
    messaging: Messaging,
    orderId: string,
    build: (lang: Lang) => OrderStatusNotification,
    extra: Record<string, string>,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        type: true,
        total: true,
        customer: {
          select: {
            pushDevices: {
              where: { isEnabled: true },
              select: { token: true, lang: true },
            },
          },
        },
      },
    });
    // Один и тот же токен не может быть на двух языках, поэтому берём
    // последний известный язык устройства.
    const byToken = new Map<string, Lang>();
    for (const d of order?.customer?.pushDevices ?? []) {
      byToken.set(d.token, d.lang === 'kk' ? 'kk' : 'ru');
    }
    const tokens = [...byToken.keys()];
    if (!order || tokens.length === 0) {
      // Молчать здесь нельзя: «некому отправлять» и «отправлено успешно»
      // выглядели в логе одинаково, и разобраться, почему уведомление не
      // пришло, было невозможно — а это первое, что проверяют.
      if (order) {
        this.logger.log(
          `Заказ №${order.number}: уведомление не отправлено — у клиента нет включённых устройств`,
        );
      }
      return;
    }

    this.logger.log(
      `Заказ №${order.number}: отправляем уведомление на ${tokens.length} устройств`,
    );

    const groups = new Map<Lang, string[]>();
    for (const [token, lang] of byToken) {
      (groups.get(lang) ?? groups.set(lang, []).get(lang)!).push(token);
    }

    for (const [lang, groupTokens] of groups)
    for (let offset = 0; offset < groupTokens.length; offset += 500) {
      const batch = groupTokens.slice(offset, offset + 500);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: build(lang),
          data: {
            orderId: order.id,
            orderNumber: String(order.number),
            total: String(order.total),
            ...extra,
          },
          android: {
            priority: 'high',
            notification: { channelId: 'orders', sound: 'default' },
          },
          apns: { payload: { aps: { sound: 'default' } } },
        });

        const invalid = response.responses.flatMap((result, index) => {
          const code = result.error?.code;
          return code && INVALID_TOKEN_CODES.has(code) ? [batch[index]] : [];
        });
        if (invalid.length > 0) {
          await this.prisma.pushDevice.updateMany({
            where: { token: { in: invalid } },
            data: { isEnabled: false },
          });
        }
        if (response.failureCount > 0) {
          // С кодом и платформой, а не просто счётчиком: «1 из 2 не
          // отправлено» не отличает протухший токен от неверного ключа
          // APNs, а чинятся они по-разному.
          const reasons = response.responses
            .map((result, index) =>
              result.error
                ? `${batch[index].slice(0, 12)}… → ${result.error.code}`
                : null,
            )
            .filter(Boolean)
            .join('; ');
          this.logger.warn(
            `Заказ №${order.number}: ${response.failureCount}/${batch.length} ` +
              `FCM-уведомлений не отправлено — ${reasons}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `FCM для заказа №${order.number} не отправлен: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private firebaseApp(): App | undefined {
    const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
    if (existing) return existing;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      const json = raw.startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const account = JSON.parse(json) as ServiceAccount & { project_id?: string };
      return initializeApp(
        {
          credential: cert(account),
          projectId: process.env.FIREBASE_PROJECT_ID ?? account.project_id,
        },
        FIREBASE_APP_NAME,
      );
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return initializeApp(
        {
          credential: applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID,
        },
        FIREBASE_APP_NAME,
      );
    }
    return undefined;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
