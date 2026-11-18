import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { esc, InlineButton, linkOrderNumbers, TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { messageSettingsOf } from '../availability/availability.service';

/**
 * Темы обращения.
 *
 * Готовый список, а не одно поле «напишите нам». Кассир читает его в
 * разгар смены: помеченный запрос она разбирает за секунду, абзац
 * свободного текста — нет. Это же и отличает кнопку от звонка, из-за
 * которого телефон и не публикуется.
 */
export const MESSAGE_TOPICS: Record<string, string> = {
  WHERE: 'Где мой заказ?',
  ADDRESS: 'Поменять адрес',
  CANCEL: 'Отменить заказ',
  MISSING: 'Забыли позицию',
  OTHER: 'Другое',
};

/**
 * Готовые ответы кассира — кнопки под сообщением в группе.
 *
 * Свои для каждой темы: на «где мой заказ» отвечают про курьера, на
 * «поменять адрес» — что приняли. «Перезвоним» есть везде: иногда
 * проще поговорить голосом.
 */
// Новые ответы дописываем в конец списка: кнопка хранит номер ответа,
// и вставка в середину подменила бы текст под уже отправленными
// вопросами, на которые ещё не ответили.
export const QUICK_REPLIES: Record<string, string[]> = {
  WHERE: [
    'Заказ готовится, скоро передадим курьеру',
    'Курьер уже в пути',
    'Будет у вас через 10–15 минут',
    'Сейчас перезвоним',
    'Заказ готов — можно забирать',
  ],
  ADDRESS: [
    'Приняли, адрес поменяли',
    'Сейчас перезвоним',
    'Поменять не получится — курьер уже в пути',
  ],
  CANCEL: [
    'Заказ отменили',
    'Заказ уже готовится, отменить не получится',
    'Сейчас перезвоним',
    'Отменили, деньги вернём на Kaspi',
  ],
  MISSING: [
    'Приняли, всё положим',
    'Сейчас перезвоним',
    'Этой позиции нет в наличии — сейчас перезвоним',
  ],
  OTHER: ['Приняли, спасибо', 'Сейчас перезвоним', 'Заказ принят, уже готовим'],
};

/**
 * Не чаще раза в десять минут и не больше трёх на заказ.
 *
 * Три минуты оказалось мало: при шести-семи заказах в работе группа
 * кассиров получала сообщение почти каждую минуту. Три обращения по
 * одному заказу — это уже разговор, который лучше вести голосом.
 */
export const MESSAGE_COOLDOWN_MS = 10 * 60_000;
export const MESSAGE_LIMIT_PER_ORDER = 3;

type ThreadRow = {
  id: string;
  topic: string;
  text: string;
  createdAt: Date;
  answerText: string | null;
  answeredAt: Date | null;
};

@Injectable()
export class OrderMessagesService {
  private readonly logger = new Logger(OrderMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * С какого момента можно спросить «Где мой заказ?».
   *
   * У предзаказа — со времени, на которое его заказали: раньше спрашивать
   * не о чем. У обычного — через N минут из настроек (по умолчанию 60):
   * столько заказ и едет, и вопрос в первые минуты только засыпает кассу.
   */
  whereAllowedAt(
    order: { createdAt: Date; scheduledAt?: Date | null },
    settings: unknown,
  ) {
    if (order.scheduledAt) return order.scheduledAt;
    const { whereAfterMinutes } = messageSettingsOf(settings);
    return new Date(order.createdAt.getTime() + whereAfterMinutes * 60_000);
  }

  /**
   * Сколько уже написано, когда можно снова и что ответили.
   *
   * Нужно приложению, а не только серверу: без этого кнопка выглядит
   * рабочей, человек жмёт её ещё раз и получает отказ вместо ответа.
   * Переписка тут же — ответ кассира человек видит на экране заказа.
   */
  async state(orderId: string, now = new Date()) {
    const [thread, order] = await Promise.all([
      this.prisma.orderMessage.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          topic: true,
          text: true,
          createdAt: true,
          answerText: true,
          answeredAt: true,
        },
      }) as Promise<ThreadRow[]>,
      this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          createdAt: true,
          scheduledAt: true,
          tenant: { select: { settings: true } },
        },
      }),
    ]);
    return this.stateOf(thread, order, now);
  }

  private stateOf(
    thread: ThreadRow[],
    order: {
      createdAt: Date;
      scheduledAt?: Date | null;
      tenant?: { settings: unknown } | null;
    } | null,
    now: Date,
  ) {
    const sent = thread.length;
    const last = thread[sent - 1];
    const nextAt = last
      ? new Date(last.createdAt.getTime() + MESSAGE_COOLDOWN_MS)
      : null;
    const whereAt = order
      ? this.whereAllowedAt(order, order.tenant?.settings)
      : null;

    return {
      sent,
      limit: MESSAGE_LIMIT_PER_ORDER,
      /// Когда снова можно писать; null — прямо сейчас
      nextAllowedAt:
        sent >= MESSAGE_LIMIT_PER_ORDER || !nextAt || nextAt <= now
          ? null
          : nextAt.toISOString(),
      /// С какого момента доступна тема «Где мой заказ?»; null — уже можно
      whereAllowedAt: whereAt && whereAt > now ? whereAt.toISOString() : null,
      thread: thread.map((m) => ({
        id: m.id,
        topic: m.topic,
        label: MESSAGE_TOPICS[m.topic] ?? m.topic,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        answerText: m.answerText,
        answeredAt: m.answeredAt?.toISOString() ?? null,
      })),
    };
  }

  async send(
    orderId: string,
    input: { topic: string; text?: string },
    now = new Date(),
  ) {
    const label = MESSAGE_TOPICS[input.topic];
    if (!label) throw new BadRequestException('Неизвестная тема обращения');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        tenantId: true,
        address: true,
        createdAt: true,
        scheduledAt: true,
        tenant: { select: { settings: true } },
        // Телефон живёт у клиента: гостевой заказ создаётся вместе с
        // карточкой клиента, отдельного поля в заказе нет
        customer: { select: { phone: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    // Закрытый заказ обсуждать поздно: смена его уже не видит, и
    // сообщение уйдёт в пустоту. Впечатления соберёт анкета.
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new BadRequestException(
        'Заказ уже закрыт — расскажите о нём в отзыве',
      );
    }

    // «Где мой заказ?» — только когда заказ и правда мог задержаться.
    // Старые сборки приложения кнопку не прячут, поэтому правило здесь.
    if (input.topic === 'WHERE') {
      const allowedAt = this.whereAllowedAt(order, order.tenant?.settings);
      if (allowedAt > now) {
        throw new BadRequestException(
          `Заказ ещё в работе. Спросить, где он, можно с ${hhmm(allowedAt, order.tenant?.settings)}`,
        );
      }
    }

    // Ограничение частоты: кнопка печатает в живой чат смены, и без
    // предела её можно превратить в спам-машину одним долгим нажатием.
    const [count, last] = await Promise.all([
      this.prisma.orderMessage.count({ where: { orderId } }),
      this.prisma.orderMessage.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    if (count >= MESSAGE_LIMIT_PER_ORDER) {
      throw new BadRequestException(
        'Мы уже получили ваши сообщения по этому заказу и разбираемся',
      );
    }
    if (last && now.getTime() - last.createdAt.getTime() < MESSAGE_COOLDOWN_MS) {
      throw new BadRequestException(
        'Сообщение уже отправлено — кассир ответит здесь же. Следующее можно через 10 минут',
      );
    }

    const text = (input.text ?? '').trim().slice(0, 500);
    const message = await this.prisma.orderMessage.create({
      data: { orderId, topic: input.topic, text },
    });

    const where =
      order.type === 'DELIVERY'
        ? this.addressLine(order.address)
        : 'самовывоз';

    // Только кассе: это действие, которое нужно сделать сейчас, а не
    // факт для сводки (DECISIONS §12.11). Под сообщением — готовые
    // ответы: кассир отвечает нажатием, а не перезвоном.
    const posted = await this.telegram.notifyCashier(
      order.tenantId,
      questionText(order.number, label, text, order.customer?.phone, where),
      replyKeyboard(message.id, input.topic),
    );
    if (posted.messageId) {
      await this.prisma.orderMessage.update({
        where: { id: message.id },
        data: {
          telegramChatId: posted.chatId,
          telegramMessageId: posted.messageId,
        },
      });
    }

    // Возвращаем состояние сразу: экран заказа обновит кнопку, не
    // дожидаясь следующего опроса статуса
    return { id: message.id, ...(await this.state(orderId, now)) };
  }

  /**
   * Ответ кассира клиенту — кнопкой или своим текстом из группы.
   *
   * Отвечают один раз: второй кассир, нажавший кнопку следом, увидит
   * «уже ответили», а клиент не получит два противоречащих пуша.
   * Сообщение в группе переписываем: вопрос и ответ с именем, чтобы
   * руководство видело, кто и что сказал.
   */
  async answer(
    messageId: string,
    answerText: string,
    answeredBy: string,
    now = new Date(),
  ): Promise<{ ok: boolean; reason?: string }> {
    const text = answerText.trim().slice(0, 500);
    if (!text) return { ok: false, reason: 'Пустой ответ' };

    // Условное обновление: из двух одновременных нажатий пройдёт одно
    const claimed = await this.prisma.orderMessage.updateMany({
      where: { id: messageId, answeredAt: null },
      data: { answerText: text, answeredBy, answeredAt: now },
    });
    if (claimed.count === 0) return { ok: false, reason: 'Уже ответили' };

    const message = await this.prisma.orderMessage.findUniqueOrThrow({
      where: { id: messageId },
      select: {
        topic: true,
        text: true,
        telegramChatId: true,
        telegramMessageId: true,
        order: {
          select: {
            id: true,
            number: true,
            type: true,
            address: true,
            tenantId: true,
            tenant: { select: { settings: true } },
            customer: { select: { phone: true } },
          },
        },
      },
    });
    const order = message.order;

    if (message.telegramChatId && message.telegramMessageId) {
      const where =
        order.type === 'DELIVERY' ? this.addressLine(order.address) : 'самовывоз';
      const { error } = await this.telegram.call(order.tenantId, 'editMessageText', {
        chat_id: message.telegramChatId,
        message_id: message.telegramMessageId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        // Ссылку на заказ ставим только в вопрос: ответ кассира — это
        // её собственный текст, номера в нём не трогаем
        text:
          linkOrderNumbers(
            questionText(
              order.number,
              MESSAGE_TOPICS[message.topic] ?? message.topic,
              message.text,
              order.customer?.phone,
              where,
            ),
          ) +
          `\n\n↩️ <b>${esc(answeredBy)}</b>, ${hhmm(now, order.tenant?.settings)}: ${esc(text)}`,
      });
      if (error) this.logger.warn(`Не переписали вопрос в группе: ${error}`);
    }

    await this.notifications.sendOrderEvent(
      order.id,
      (lang) => ({
        title:
          lang === 'kk' ? `№${order.number} тапсырыс` : `Заказ №${order.number}`,
        body: text,
      }),
      { type: 'order_reply' },
    );
    return { ok: true };
  }

  /** Адрес одной строкой; в заказе он лежит структурой */
  private addressLine(address: unknown): string {
    const a = (address ?? {}) as Record<string, unknown>;
    const parts = [a.street, a.house].filter(Boolean).join(' ');
    const flat = a.flat ? `, кв. ${a.flat}` : '';
    return parts ? `${parts}${flat}` : '';
  }
}

function questionText(
  number: number,
  label: string,
  text: string,
  phone: string | undefined,
  where: string,
) {
  return (
    `✉️ Заказ №${number} — ${esc(label)}\n` +
    (text ? `\n«${esc(text)}»\n` : '') +
    `\n${phone ?? 'телефон не указан'}` +
    (where ? ` · ${esc(where)}` : '')
  );
}

/**
 * Кнопки под вопросом: готовые ответы и «свой ответ».
 *
 * В callback_data — id сообщения и номер ответа, а не сам текст:
 * Телеграм ограничивает её 64 байтами.
 */
export function replyKeyboard(messageId: string, topic: string): InlineButton[][] {
  const replies = QUICK_REPLIES[topic] ?? QUICK_REPLIES.OTHER;
  return [
    ...replies.map((text, i) => [{ text, callback_data: `r:${messageId}:${i}` }]),
    [{ text: '✍️ Свой ответ', callback_data: `c:${messageId}` }],
  ];
}

/** Время по часовому поясу заведения: «20:55» */
export function hhmm(at: Date, settings: unknown) {
  const tz =
    ((settings ?? {}) as Record<string, unknown>).timezone?.toString() ??
    'Asia/Almaty';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}
