import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "./orders.service";

/// Через сколько напомнить, что заказ не оплачен.
export const UNPAID_REMIND_AFTER_MS = 3 * 60_000;
/// Через сколько снять неоплаченный заказ, если клиент так и не ответил.
export const UNPAID_CANCEL_AFTER_MS = 30 * 60_000;

/**
 * Заказы с Kaspi, которые так и не оплатили.
 *
 * Такой заказ не уходит в Poster, но без присмотра висит вечно: клиент
 * думает, что заказ оформлен, и через час пишет «где мой заказ», а
 * списанные баллы остаются заблокированными. Поэтому через три минуты
 * напоминаем («оплатите или отмените»), а через полчаса снимаем сами —
 * баллы при отмене возвращаются штатно.
 */
@Injectable()
export class UnpaidOrdersService {
  private readonly logger = new Logger(UnpaidOrdersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron("*/1 * * * *")
  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.remind(now);
      await this.cancelStale(now);
    } finally {
      this.running = false;
    }
  }

  async remind(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: {
        paymentMethod: "KASPI_ONLINE",
        paymentStatus: "PENDING",
        status: "NEW",
        unpaidRemindedAt: null,
        createdAt: {
          lte: new Date(now.getTime() - UNPAID_REMIND_AFTER_MS),
          // Старше срока автоотмены напоминать уже поздно.
          gt: new Date(now.getTime() - UNPAID_CANCEL_AFTER_MS),
        },
      },
      select: { id: true, number: true },
      take: 50,
    });
    for (const order of due) {
      // Сначала помечаем: два контейнера не должны прислать два пуша.
      const claimed = await this.prisma.order.updateMany({
        where: { id: order.id, unpaidRemindedAt: null },
        data: { unpaidRemindedAt: now },
      });
      if (claimed.count === 0) continue;
      await this.notifications.sendOrderEvent(
        order.id,
        (lang) =>
          lang === "kk"
            ? {
                title: `№${order.number} тапсырыс төленбеді`,
                body: "Тапсырыс асханаға жіберілмеді. Төлейсіз бе, әлде бас тартасыз ба?",
              }
            : {
                title: `Заказ №${order.number} не оплачен`,
                body: "Мы ещё не начали готовить. Оплатите или отмените заказ.",
              },
        { type: "order_unpaid" },
      );
    }
    return due.length;
  }

  async cancelStale(now = new Date()) {
    const stale = await this.prisma.order.findMany({
      where: {
        paymentMethod: "KASPI_ONLINE",
        paymentStatus: "PENDING",
        status: "NEW",
        createdAt: { lte: new Date(now.getTime() - UNPAID_CANCEL_AFTER_MS) },
        // Человек прямо сейчас подтверждает оплату в Kaspi — не мешаем.
        paymentAttempts: { none: { status: "WAIT" } },
      },
      select: { id: true, number: true, tenantId: true },
      take: 50,
    });
    for (const order of stale) {
      try {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            cancelReason: "Не оплачен — отменён автоматически",
            cancelledBy: "SYSTEM",
            cancelledAt: now,
          },
        });
        await this.orders.setStatus(order.id, "CANCELLED", order.tenantId);
        this.logger.log(`Заказ №${order.number} снят: не оплачен за 30 минут`);
      } catch (error) {
        this.logger.warn(
          `Неоплаченный заказ №${order.number} не снят: ${String(error)}`,
        );
      }
    }
    return stale.length;
  }
}
