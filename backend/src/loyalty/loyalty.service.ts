import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  /** 1 балл = 1 ₸. Баллами оплачиваются товары, но не доставка. */
  validateSpend(balance: number, subtotal: number, requested = 0) {
    if (!Number.isInteger(requested) || requested < 0) {
      throw new BadRequestException('Количество баллов должно быть целым и неотрицательным');
    }
    if (requested > balance) {
      throw new BadRequestException(`Недостаточно баллов: доступно ${balance}`);
    }
    if (requested > subtotal) {
      throw new BadRequestException('Баллами нельзя оплатить больше стоимости товаров');
    }
    return requested;
  }

  /** Атомарно списывает баланс и записывает строку журнала. */
  async spendForOrder(
    tx: Tx,
    params: {
      tenantId: string;
      customerId: string;
      orderId: string;
      orderNumber: number;
      amount: number;
    },
  ) {
    if (params.amount === 0) return;
    const updated = await tx.customer.updateMany({
      where: {
        id: params.customerId,
        tenantId: params.tenantId,
        pointsBalance: { gte: params.amount },
      },
      data: { pointsBalance: { decrement: params.amount } },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('Баланс изменился — обновите корзину и попробуйте снова');
    }
    await tx.loyaltyTransaction.create({
      data: {
        tenantId: params.tenantId,
        customerId: params.customerId,
        orderId: params.orderId,
        type: 'SPEND',
        amount: -params.amount,
        comment: `Оплата заказа №${params.orderNumber}`,
      },
    });
  }

  /**
   * Начисляет кэшбэк один раз после доставки. База — реально оплаченные
   * товары без доставки; часть, закрытая баллами, новый кэшбэк не даёт.
   */
  async earnForDeliveredOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Блокировка заказа сериализует параллельные смены статуса без
      // добавления опасных для staging уникальных ограничений к старой БД.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { tenant: { select: { settings: true } } },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status !== 'DELIVERED' || !order.customerId) return 0;

      const pct = this.cashbackPct(order.tenant.settings, 1);
      const eligible = Math.max(0, order.subtotal - order.pointsSpent);
      const amount = Math.floor((eligible * pct) / 100);
      if (amount <= 0) return 0;

      const existing = await tx.loyaltyTransaction.findFirst({
        where: { orderId: order.id, type: 'EARN' },
      });
      if (existing) return existing.amount;

      await tx.loyaltyTransaction.create({
        data: {
          tenantId: order.tenantId,
          customerId: order.customerId,
          orderId: order.id,
          type: 'EARN',
          amount,
          comment: `Кэшбэк ${pct}% за заказ №${order.number}`,
        },
      });

      await Promise.all([
        tx.customer.update({
          where: { id: order.customerId },
          data: { pointsBalance: { increment: amount } },
        }),
        tx.order.update({ where: { id: order.id }, data: { pointsEarned: amount } }),
      ]);
      return amount;
    });
  }

  /** Возвращает списанные баллы при отмене, строго один раз. */
  async refundCancelledOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status !== 'CANCELLED' || !order.customerId || order.pointsSpent <= 0) {
        return 0;
      }
      const existing = await tx.loyaltyTransaction.findFirst({
        where: { orderId: order.id, type: 'ADJUST' },
      });
      if (existing) return 0;
      await tx.loyaltyTransaction.create({
        data: {
          tenantId: order.tenantId,
          customerId: order.customerId,
          orderId: order.id,
          type: 'ADJUST',
          amount: order.pointsSpent,
          comment: `Возврат баллов за отменённый заказ №${order.number}`,
        },
      });
      await tx.customer.update({
        where: { id: order.customerId },
        data: { pointsBalance: { increment: order.pointsSpent } },
      });
      return order.pointsSpent;
    });
  }

  async adjust(
    customerId: string,
    amount: number,
    comment: string,
    tenantId?: string,
  ) {
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10_000_000) {
      throw new BadRequestException('Корректировка должна быть целым числом от −10 000 000 до 10 000 000');
    }
    const note = comment.trim();
    if (note.length < 3) throw new BadRequestException('Укажите причину корректировки');

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, ...(tenantId ? { tenantId } : {}) },
      });
      if (!customer) throw new NotFoundException('Клиент не найден');
      if (customer.pointsBalance + amount < 0) {
        throw new BadRequestException('Нельзя списать больше текущего баланса');
      }
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { pointsBalance: { increment: amount } },
        select: { pointsBalance: true },
      });
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          tenantId: customer.tenantId,
          customerId: customer.id,
          type: 'ADJUST',
          amount,
          comment: note,
        },
      });
      return { pointsBalance: updated.pointsBalance, transaction };
    });
  }

  async onStatusChanged(orderId: string, status: OrderStatus) {
    if (status === 'DELIVERED') return this.earnForDeliveredOrder(orderId);
    if (status === 'CANCELLED') return this.refundCancelledOrder(orderId);
    return 0;
  }

  cashbackPct(settings: Prisma.JsonValue, loyaltyLevel = 1) {
    const loyalty = (settings as any)?.loyalty ?? {};
    const direct = Number(loyalty.cashbackPct);
    if (Number.isFinite(direct) && direct >= 0 && direct <= 100) return direct;
    const level = Array.isArray(loyalty.levels)
      ? loyalty.levels.find((item: any) => Number(item.level) === loyaltyLevel)
      : null;
    const fromLevel = Number(level?.cashbackPct);
    return Number.isFinite(fromLevel) && fromLevel >= 0 && fromLevel <= 100
      ? fromLevel
      : 3;
  }
}
