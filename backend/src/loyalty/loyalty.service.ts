import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface LoyaltyPolicy {
  cashbackPct: number;
  earnWhenPointsSpent: boolean;
  allowPointsWithPromotions: boolean;
  earnOnPromotionalOrders: boolean;

  /**
   * Какую долю стоимости товаров можно закрыть баллами, %.
   *
   * 100 — без ограничения. Ограничение считается от товаров, а не от
   * суммы к оплате: баллами и так нельзя платить за доставку, и включать
   * её в базу значило бы, что потолок растёт от расстояния.
   */
  maxSpendPct: number;
}

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Сколько баллов можно списать в этом заказе.
   *
   * Потолок в процентах — настройка заведения: без него человек с
   * большим балансом закрывает баллами почти весь чек, и заказ приносит
   * заведению почти ничего живыми деньгами.
   */
  maxSpend(settings: Prisma.JsonValue, subtotal: number) {
    const pct = this.policy(settings).maxSpendPct;
    if (pct >= 100) return subtotal;
    return Math.floor((subtotal * pct) / 100);
  }

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

  /** Начисляет кэшбэк один раз после доставки по текущей политике заведения. */
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

      const promotionalDiscount = Math.max(
        0,
        order.discount - order.pointsSpent,
      );

      // Процент берём по уровню КЛИЕНТА, а не по первому уровню: иначе
      // вся лестница уровней ничего не меняет и существует только на
      // карточке в профиле.
      const customer = await tx.customer.findUnique({
        where: { id: order.customerId },
        select: { loyaltyLevel: true, lifetimeSpent: true },
      });
      const level = customer?.loyaltyLevel ?? 1;

      const policy = this.policy(order.tenant.settings, level);
      const amount = this.cashbackAmount(order.tenant.settings, {
        subtotal: order.subtotal,
        pointsSpent: order.pointsSpent,
        promotionalDiscount,
        loyaltyLevel: level,
      });
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
          comment: `Кэшбэк ${policy.cashbackPct}% за заказ №${order.number}`,
        },
      });

      // Оборот и уровень обновляем здесь же: заказ выполнен — значит
      // деньги получены, и это единственный момент, когда уровень может
      // измениться.
      const nextSpent = (customer?.lifetimeSpent ?? 0) + order.total;
      const nextLevel = this.levelFor(
        order.tenant.settings,
        nextSpent,
      ).current.level;

      await Promise.all([
        tx.customer.update({
          where: { id: order.customerId },
          data: {
            pointsBalance: { increment: amount },
            lifetimeSpent: nextSpent,
            loyaltyLevel: nextLevel,
          },
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

  /// Уровни кэшбэка по умолчанию (решение владельца 15.08.2026).
  ///
  /// Порог — оборот выполненных заказов **за всё время**. Уровень никогда
  /// не понижается: понижение читается клиентом как наказание и стоит
  /// дороже, чем выигрыш в активности. У арендатора список настраивается
  /// в `settings.loyalty.levels`.
  static readonly defaultLevels = [
    { level: 1, name: 'Новичок', cashbackPct: 3, minSpent: 0 },
    { level: 2, name: 'Свой', cashbackPct: 4, minSpent: 50_000 },
    { level: 3, name: 'Частый', cashbackPct: 5, minSpent: 100_000 },
    { level: 4, name: 'Постоянный', cashbackPct: 6, minSpent: 150_000 },
  ];

  levels(settings: Prisma.JsonValue) {
    const configured = (settings as any)?.loyalty?.levels;
    const list = Array.isArray(configured) && configured.length
      ? configured.map((item: any, index: number) => ({
          level: Number(item.level ?? index + 1),
          name: String(item.name ?? `Уровень ${index + 1}`),
          cashbackPct: Number(item.cashbackPct ?? 3),
          minSpent: Number(item.minSpent ?? 0),
        }))
      : LoyaltyService.defaultLevels;
    return [...list].sort((a, b) => a.minSpent - b.minSpent);
  }

  /// Какой уровень соответствует обороту. Возвращает и следующий уровень,
  /// чтобы приложение могло показать «ещё N ₸ — и кэшбэк станет X%».
  levelFor(settings: Prisma.JsonValue, lifetimeSpent: number) {
    const levels = this.levels(settings);
    let current = levels[0];
    for (const level of levels) {
      if (lifetimeSpent >= level.minSpent) current = level;
    }
    const next = levels.find((l) => l.minSpent > lifetimeSpent) ?? null;
    return {
      current,
      next,
      toNext: next ? Math.max(0, next.minSpent - lifetimeSpent) : 0,
      total: levels.length,
    };
  }

  cashbackPct(settings: Prisma.JsonValue, loyaltyLevel = 1) {
    const loyalty = (settings as any)?.loyalty ?? {};

    // Плоский процент для всех — если арендатор не хочет лестницу вообще
    const direct = Number(loyalty.cashbackPct);
    if (Number.isFinite(direct) && direct >= 0 && direct <= 100) return direct;

    // Ищем в лестнице — той же, что и levelFor(). Раньше здесь читались
    // только настройки арендатора, и при пустых настройках любой уровень
    // давал 3%: лестница существовала лишь на карточке в профиле.
    const level = this.levels(settings).find((l) => l.level === loyaltyLevel);
    const fromLevel = Number(level?.cashbackPct);
    return Number.isFinite(fromLevel) && fromLevel >= 0 && fromLevel <= 100
      ? fromLevel
      : 3;
  }

  /**
   * Правила по умолчанию повторяют действующую политику заведения:
   * баллы и акции не складываются, а за заказ с любой из этих выгод
   * новый кэшбэк не начисляется.
   */
  policy(settings: Prisma.JsonValue, loyaltyLevel = 1): LoyaltyPolicy {
    const loyalty = (settings as any)?.loyalty ?? {};
    return {
      cashbackPct: this.cashbackPct(settings, loyaltyLevel),
      earnWhenPointsSpent: loyalty.earnWhenPointsSpent === true,
      allowPointsWithPromotions:
        loyalty.allowPointsWithPromotions === true,
      earnOnPromotionalOrders:
        loyalty.earnOnPromotionalOrders === true,
      // Умолчание — без ограничения: включать потолок молча означало бы
      // менять правила игры для клиентов, которые уже копили баллы.
      maxSpendPct: this.clampPct(loyalty.maxSpendPct),
    };
  }

  /** Процент из настроек: мусор и выход за границы — это «без ограничения» */
  private clampPct(value: unknown): number {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 100;
    return Math.round(pct);
  }

  cashbackAmount(
    settings: Prisma.JsonValue,
    order: {
      subtotal: number;
      pointsSpent: number;
      promotionalDiscount: number;
      loyaltyLevel?: number;
    },
  ) {
    const policy = this.policy(settings, order.loyaltyLevel ?? 1);
    if (order.pointsSpent > 0 && !policy.earnWhenPointsSpent) return 0;
    if (
      order.promotionalDiscount > 0 &&
      !policy.earnOnPromotionalOrders
    ) {
      return 0;
    }
    const eligible = Math.max(0, order.subtotal - order.pointsSpent);
    return Math.floor((eligible * policy.cashbackPct) / 100);
  }
}
