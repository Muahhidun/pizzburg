import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { AvailabilityService } from '../availability/availability.service';

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
 * бесплатной отмены и ожидание оплаты Kaspi — не вина кассы. Заказ,
 * пришедший ночью, ждёт открытия: пока закрыто, не напоминаем, а
 * минуты считаем с начала смены — «не принят 317 мин» в 10:05 врёт.
 */
@Injectable()
export class AcceptReminderService {
  private readonly logger = new Logger(AcceptReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly availability: AvailabilityService,
  ) {}

  /** С какого момента касса могла принять заказ: отправка или открытие */
  private waitStart(settings: unknown, sentAt: number, at: Date): number | null {
    const shift = this.availability.openSince(settings, at);
    if (!shift.open) return null;
    return Math.max(sentAt, shift.since?.getTime() ?? sentAt);
  }

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
        tenant: { select: { settings: true } },
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
      // Пока закрыто — молчим; после открытия считаем от начала смены
      const start = this.waitStart(o.tenant?.settings, sentAt, now);
      if (start === null) continue;
      const minutes = Math.floor((now.getTime() - start) / 60_000);
      if (minutes < ACCEPT_REMIND_CASHIER_MIN) continue;
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
          const posted = await this.telegram.notifyCashier(
            o.tenantId,
            `⏰ <b>Заказ №${o.number} ждёт принятия ${minutes} мин</b> (${kind})\n` +
              'Клиент видит «Ждём подтверждения». Примите заказ на планшете.',
          );
          // Запоминаем, чтобы после принятия переписать на «✅ принят»
          if (posted?.messageId) {
            await this.prisma.order.update({
              where: { id: o.id },
              data: {
                acceptReminderChatId: posted.chatId,
                acceptReminderMessageId: posted.messageId,
              },
            });
          }
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

    await this.resolve();
  }

  /**
   * Переписывает «ждёт принятия» на итог, когда заказ приняли или отменили.
   *
   * Сообщение не удаляем: иначе отвлёкшийся кассир не поймёт, был ли
   * заказ, а руководство теряет историю задержек. Правка не пищит в
   * группе — звук остаётся только у того, что действительно ждёт.
   *
   * Время принятия — `updatedAt`: опрос Poster ставит ACCEPTED раз в
   * минуту и больше заказ до этого крона не трогает (см. closeStale).
   */
  async resolve() {
    const done = await this.prisma.order.findMany({
      where: { acceptReminderMessageId: { not: null }, status: { not: 'NEW' } },
      select: {
        id: true,
        number: true,
        tenantId: true,
        type: true,
        status: true,
        updatedAt: true,
        cancelledAt: true,
        acceptReminderChatId: true,
        acceptReminderMessageId: true,
        tenant: { select: { settings: true } },
        dispatches: { select: { status: true, sentAt: true } },
      },
    });
    for (const o of done) {
      // Захват: правим ровно один раз, даже при двух экземплярах сервера
      const claimed = await this.prisma.order.updateMany({
        where: { id: o.id, acceptReminderMessageId: o.acceptReminderMessageId },
        data: { acceptReminderChatId: null, acceptReminderMessageId: null },
      });
      if (claimed.count === 0 || !o.acceptReminderChatId) continue;

      const sentAt = o.dispatches
        .filter((d) => d.status === 'SENT' && d.sentAt)
        .map((d) => d.sentAt!.getTime())
        .sort((a, b) => a - b)[0];
      const kind = o.type === 'DELIVERY' ? 'доставка' : 'самовывоз';
      const at = o.cancelledAt ?? o.updatedAt;
      const start = sentAt ? (this.waitStart(o.tenant?.settings, sentAt, at) ?? sentAt) : undefined;
      const text = acceptResolvedText(o.number, kind, o.status, start, at);

      try {
        const { error } = await this.telegram.call(o.tenantId, 'editMessageText', {
          chat_id: o.acceptReminderChatId,
          message_id: o.acceptReminderMessageId,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          text: await this.telegram.linkOrders(o.tenantId, text),
        });
        if (error) this.logger.warn(`Не переписали напоминание №${o.number}: ${error}`);
      } catch (e) {
        this.logger.warn(`Не переписали напоминание №${o.number}: ${e}`);
      }
    }
  }
}

/** Итог вместо «ждёт принятия»: принят через N мин или отменён */
export function acceptResolvedText(
  number: number,
  kind: string,
  status: string,
  sentAt: number | undefined,
  at: Date,
): string {
  if (status === 'CANCELLED') {
    return `❌ <b>Заказ №${number} отменён</b>, так и не был принят (${kind})`;
  }
  const minutes = sentAt ? Math.max(0, Math.round((at.getTime() - sentAt) / 60_000)) : null;
  return minutes === null
    ? `✅ <b>Заказ №${number} принят</b> (${kind})`
    : `✅ <b>Заказ №${number} принят через ${minutes} мин</b> (${kind})`;
}
