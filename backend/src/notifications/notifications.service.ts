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
): OrderStatusNotification {
  const title = `Заказ №${orderNumber}`;
  const body: Record<OrderStatus, string> = {
    NEW: 'Отправлен на кухню',
    ACCEPTED: 'Принят рестораном',
    COOKING: 'Уже готовится',
    READY: type === 'PICKUP' ? 'Готов к выдаче' : 'Готов и скоро отправится к вам',
    ON_WAY: 'Курьер уже в пути',
    DELIVERED: type === 'PICKUP' ? 'Выдан. Спасибо за заказ!' : 'Доставлен. Приятного аппетита!',
    CANCELLED: 'Отменён',
  };
  return { title, body: body[status] };
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
    input: { token: string; platform: PushPlatform; appVersion?: string },
  ) {
    await this.prisma.pushDevice.upsert({
      where: { token: input.token },
      create: {
        customerId,
        token: input.token,
        platform: input.platform,
        appVersion: input.appVersion,
      },
      update: {
        customerId,
        platform: input.platform,
        appVersion: input.appVersion,
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
    notification: OrderStatusNotification,
    data: Record<string, string> = {},
  ) {
    const messaging = this.messaging;
    if (!messaging) return;

    try {
      await this.deliverToCustomer(messaging, orderId, notification, data);
    } catch (error) {
      this.logger.warn(
        `FCM для заказа ${orderId} не отправлен: ${this.errorMessage(error)}`,
      );
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
      orderStatusNotification(order.number, status, order.type),
      { type: 'order_status', status },
    );
  }

  private async deliverToCustomer(
    messaging: Messaging,
    orderId: string,
    notification: OrderStatusNotification,
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
              select: { token: true },
            },
          },
        },
      },
    });
    const tokens = [...new Set(order?.customer?.pushDevices.map((d) => d.token) ?? [])];
    if (!order || tokens.length === 0) return;

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification,
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
          this.logger.warn(
            `Заказ №${order.number}: ${response.failureCount}/${batch.length} FCM-уведомлений не отправлено`,
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
