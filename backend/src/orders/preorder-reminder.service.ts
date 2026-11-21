import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { preorderLabel } from './orders.service';

/** За сколько минут до предзаказа напоминаем кассе */
export const PREORDER_REMIND_MIN = 30;

/**
 * «Через 30 минут предзаказ №N» — в группу кассиров.
 *
 * Предзаказ приходит за часы до своего времени, и сообщение о нём к тому
 * моменту уже далеко вверху. Номер в напоминании ведёт на исходное
 * сообщение о заказе — там адрес, состав и оплата.
 *
 * Заказ, оформленный меньше чем за 40 минут до своего времени, — по сути
 * обычный: о нём только что написали, второе сообщение было бы шумом.
 */
@Injectable()
export class PreorderReminderService {
  private readonly logger = new Logger(PreorderReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('*/1 * * * *')
  async run(now = new Date()) {
    const soon = new Date(now.getTime() + PREORDER_REMIND_MIN * 60_000);
    const due = await this.prisma.order.findMany({
      where: {
        scheduledAt: { gt: now, lte: soon },
        preorderRemindedAt: null,
        status: { notIn: ['CANCELLED', 'DELIVERED'] },
        // Касса о заказе уже знает: чек ушёл на планшет
        dispatches: { some: { status: 'SENT' } },
      },
      select: {
        id: true,
        number: true,
        tenantId: true,
        type: true,
        createdAt: true,
        scheduledAt: true,
        tenant: { select: { settings: true } },
      },
    });

    for (const o of due) {
      const at = o.scheduledAt!;
      const fresh = at.getTime() - o.createdAt.getTime() <= 40 * 60_000;
      // Захват: два экземпляра сервера не отправят одно напоминание дважды
      const claimed = await this.prisma.order.updateMany({
        where: { id: o.id, preorderRemindedAt: null },
        data: { preorderRemindedAt: now },
      });
      if (claimed.count === 0 || fresh) continue;

      const tz = (o.tenant?.settings as any)?.timezone ?? 'Asia/Almaty';
      const minutes = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000));
      try {
        await this.telegram.notifyCashier(
          o.tenantId,
          preorderReminderText(o.number, minutes, preorderLabel(at, tz), o.type),
        );
      } catch (e) {
        this.logger.warn(`Напоминание о предзаказе №${o.number} не отправлено: ${e}`);
      }
    }
  }
}

export function preorderReminderText(
  number: number,
  minutes: number,
  label: string,
  type: string,
) {
  return (
    `⏰ <b>Через ${minutes} мин предзаказ №${number}</b> — на ${label}, ` +
    `${type === 'DELIVERY' ? 'доставка' : 'самовывоз'}.\n` +
    'Пора готовить. Нажмите на номер — откроется сообщение с заказом.'
  );
}
