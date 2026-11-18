import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

/** Через сколько минут после отправки на планшет напоминаем кассе */
export const ACCEPT_REMIND_CASHIER_MIN = 5;
/** …и через сколько — руководству */
export const ACCEPT_REMIND_OWNER_MIN = 10;

/**
 * Напоминание о заказе, который долго не принимают на планшете.
 *
 * Заказ стоит у кассира перед глазами, но в очередь в зале его легко
 * пропустить, а клиент всё это время видит «Ждём подтверждения». Первое
 * напоминание — в группу кассиров, второе — руководству: если и оно не
 * помогло, на кассе что-то не так.
 *
 * Счёт идёт от отправки чека на планшет, а не от оформления: окно
 * бесплатной отмены и ожидание оплаты Kaspi — не вина кассы.
 */
@Injectable()
export class AcceptReminderService {
  private readonly logger = new Logger(AcceptReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('*/1 * * * *')
  async run(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: {
        status: 'NEW',
        acceptReminders: { lt: 2 },
        // Старше суток не трогаем: такие закроет автозакрытие
        createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) },
        dispatches: {
          some: {
            status: 'SENT',
            posterOrderId: { not: null },
            OR: [{ posterStatus: null }, { posterStatus: 'NEW' }],
            sentAt: { lte: new Date(now.getTime() - ACCEPT_REMIND_CASHIER_MIN * 60_000) },
          },
        },
      },
      select: {
        id: true,
        number: true,
        tenantId: true,
        type: true,
        scheduledAt: true,
        acceptReminders: true,
        dispatches: { select: { status: true, sentAt: true, posterStatus: true } },
      },
    });

    for (const o of due) {
      // Предзаказ на потом кассир может принять ближе к сроку — не торопим
      if (o.scheduledAt && o.scheduledAt.getTime() - now.getTime() > 60 * 60_000) continue;

      const sentAt = o.dispatches
        .filter((d) => d.status === 'SENT' && d.sentAt)
        .map((d) => d.sentAt!.getTime())
        .sort((a, b) => a - b)[0];
      if (!sentAt) continue;
      const minutes = Math.floor((now.getTime() - sentAt) / 60_000);
      const stage = minutes >= ACCEPT_REMIND_OWNER_MIN ? 2 : 1;
      if (stage <= o.acceptReminders) continue;

      // Захват: два экземпляра сервера не отправят одно напоминание дважды
      const claimed = await this.prisma.order.updateMany({
        where: { id: o.id, acceptReminders: o.acceptReminders, status: 'NEW' },
        data: { acceptReminders: stage },
      });
      if (claimed.count === 0) continue;

      const kind = o.type === 'DELIVERY' ? 'доставка' : 'самовывоз';
      try {
        if (stage === 1) {
          await this.telegram.notifyCashier(
            o.tenantId,
            `⏰ <b>Заказ №${o.number} ждёт принятия ${minutes} мин</b> (${kind})\n` +
              'Клиент видит «Ждём подтверждения». Примите заказ на планшете.',
          );
        } else {
          await this.telegram.notify(
            o.tenantId,
            `⏰ <b>Заказ №${o.number} не принят уже ${minutes} мин</b> (${kind})\n` +
              'Напоминание кассе не помогло — проверьте планшет.',
          );
        }
      } catch (e) {
        this.logger.warn(`Напоминание о №${o.number} не отправлено: ${e}`);
      }
    }
  }
}
