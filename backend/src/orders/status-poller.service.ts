import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

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
}
