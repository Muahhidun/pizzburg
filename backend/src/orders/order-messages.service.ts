import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

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

/** Не чаще одного раза в минуту и не больше пяти на заказ */
export const MESSAGE_COOLDOWN_MS = 60_000;
export const MESSAGE_LIMIT_PER_ORDER = 5;

@Injectable()
export class OrderMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

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
      throw new BadRequestException('Сообщение уже отправлено, подождите минуту');
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
    // факт для сводки (DECISIONS §12.11). Руководство увидит частоту
    // обращений в отчётах, а не по одному в чате.
    await this.telegram.notifyCashier(
      order.tenantId,
      `✉️ Заказ №${order.number} — ${label}\n` +
        (text ? `\n«${text}»\n` : '') +
        `\n${order.customer?.phone ?? 'телефон не указан'}` +
        (where ? ` · ${where}` : ''),
    );

    return { id: message.id, sent: true };
  }

  /** Адрес одной строкой; в заказе он лежит структурой */
  private addressLine(address: unknown): string {
    const a = (address ?? {}) as Record<string, unknown>;
    const parts = [a.street, a.house].filter(Boolean).join(' ');
    const flat = a.flat ? `, кв. ${a.flat}` : '';
    return parts ? `${parts}${flat}` : '';
  }
}
