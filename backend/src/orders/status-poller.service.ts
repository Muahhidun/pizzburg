import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

/** Через сколько принятый заказ закрывается сам (см. DECISIONS §12.8) */
const AUTO_CLOSE_HOURS = 3;

/**
 * Раз в минуту подтягивает статусы активных заказов с планшетов Poster.
 * Смена агрегированного статуса проходит через OrdersService.setStatus,
 * где сохраняется статус, обрабатывается лояльность и отправляется FCM.
 */
@Injectable()
export class StatusPollerService {
  private readonly logger = new Logger(StatusPollerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  @Cron('*/1 * * * *')
  async poll() {
    const active = await this.prisma.order.findMany({
      where: {
        status: { in: ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        dispatches: {
          some: { status: 'SENT', posterOrderId: { not: 'dry-run' } },
        },
      },
      select: { id: true, number: true, status: true },
    });
    // Раньше цикл молчал, пока статус не менялся, и «опрос не видит заказ»
    // выглядело в логах ровно как «Poster ещё не принял». Отличить одно от
    // другого было нечем, поэтому пишем сам факт круга и что ответил Poster
    // по каждой части.
    if (active.length === 0) return;
    this.logger.log(
      `Опрос: активных заказов ${active.length} (${active
        .map((o) => `№${o.number}/${o.status}`)
        .join(', ')})`,
    );
    for (const o of active) {
      try {
        const res = await this.orders.syncStatus(o.id);
        if (res.status !== o.status) {
          this.logger.log(
            `Заказ №${o.number}: ${o.status} → ${res.status}`,
          );
        } else {
          this.logger.log(
            `Заказ №${o.number}: без изменений (${res.parts
              .map((p) => `${p.department}=${p.posterStatus ?? 'нет ответа'}`)
              .join(', ')})`,
          );
        }
      } catch (e) {
        this.logger.warn(`Poll failed for order ${o.id}: ${e}`);
      }
    }
  }

  /**
   * Закрывает заказы, которые давно приняли и о которых больше никто не
   * отчитается.
   *
   * Poster сообщает только приём и отказ, курьерского модуля пока нет, и
   * «доставлен» не ставит никто. Из-за этого заказ оставался активным
   * навсегда: висел карточкой на главном экране и числился активным в
   * истории. Три часа с запасом перекрывают доставку даже в час пик.
   *
   * Отсчёт идёт от `updatedAt` — момента, когда статус стал ACCEPTED.
   * Отдельного `acceptedAt` в модели нет, а принятый заказ до закрытия
   * больше ничем не трогают, так что это то же самое время.
   *
   * Закрываем через `setStatus`, а не прямым апдейтом: там начисляется
   * кэшбэк. Владелец сознательно принял риск начислить его и за заказ,
   * отменённый по телефону, — недоначисление раздражает клиента сильнее.
   * Клиенту при этом ничего не отправляем: через три часа он давно поел,
   * и уведомление «заказ завершён» было бы шумом.
   */
  @Cron('*/5 * * * *')
  async closeStale() {
    const threshold = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: { in: ['ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
        updatedAt: { lt: threshold },
      },
      select: { id: true, number: true, tenantId: true },
    });
    for (const o of stale) {
      try {
        await this.orders.setStatus(o.id, 'DELIVERED' as OrderStatus, o.tenantId, {
          notify: false,
        });
        this.logger.log(
          `Заказ №${o.number} закрыт автоматически: ${AUTO_CLOSE_HOURS} ч после приёма`,
        );
      } catch (e) {
        this.logger.warn(`Автозакрытие №${o.number} не удалось: ${e}`);
      }
    }
  }
}
