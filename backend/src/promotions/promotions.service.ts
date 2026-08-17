import { Injectable } from '@nestjs/common';
import { Promotion, PromotionKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CartItemInput {
  productId: string;
  qty: number;
}

export interface GiftLine {
  productId: string;
  name: string;
  price: number; // полная кассовая цена (для Poster и «Личной интеграции»)
  qty: number;
  promotionId: string;
  promotionName: string;
}

export interface PromoContext {
  /// Сумма товаров до скидок, ₸
  subtotal: number;
  orderType?: 'DELIVERY' | 'PICKUP';
  customerId?: string;
  /// Заказ первый у этого клиента
  isFirstOrder?: boolean;
  /// Не учитывать применения этого заказа в лимитах.
  ///
  /// Нужно при пересчёте уже оформленного заказа (нехватка позиции,
  /// DECISIONS §12.9): его применения уже записаны в PromotionUse, и без
  /// этого акция с лимитом «раз на клиента» выглядела бы исчерпанной
  /// собственным заказом — подарок молча пропал бы при пересчёте.
  excludeOrderId?: string;
}

export interface PromoResult {
  gifts: GiftLine[];
  /// Стоимость подарков — не вычитается из суммы, клиент их просто не платит
  giftValue: number;
  /// Денежная скидка, ₸ — её нужно вычесть из суммы к оплате
  moneyDiscount: number;
  freeDelivery: boolean;
  applied: string[];
  /// Что именно сработало — нужно для записи в PromotionUse
  appliedPromotions: { id: string; name: string; discount: number }[];

  /// Ближайшая невыполненная акция на сумму: «добавьте ещё на N ₸».
  /// Считает сервер — приложение не должно знать пороги акций.
  nextGift: { name: string; missing: number; giftName: string } | null;
}

const EMPTY: PromoResult = {
  gifts: [],
  giftValue: 0,
  moneyDiscount: 0,
  freeDelivery: false,
  applied: [],
  appliedPromotions: [],
  nextGift: null,
};

/**
 * Промо-движок приложения. Правила живут в нашей БД.
 *
 * Два вида выгоды принципиально разные и не смешиваются:
 * — **подарок** не уменьшает сумму заказа, клиент просто не платит за
 *   позицию; в Poster она уходит полной ценой и гасится «Личной
 *   интеграцией»;
 * — **денежная скидка** уменьшает сумму к оплате и точно так же уходит
 *   в Poster предоплатой, иначе смена не сойдётся.
 *
 * Ограничения («первый заказ», «раз на клиента», лимит применений)
 * проверяются по таблице PromotionUse: сама акция истории не хранит.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Считает выгоду для корзины.
   *
   * `promoCode` передаётся, если клиент ввёл код; акции с `code = null`
   * применяются автоматически.
   */
  async evaluate(
    tenantId: string,
    items: CartItemInput[],
    promoCode?: string,
    context: PromoContext = { subtotal: 0 },
  ): Promise<PromoResult> {
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ code: null }, ...(promoCode ? [{ code: promoCode }] : [])],
      },
    });
    const active = promos.filter(
      (p) =>
        (!p.activeFrom || p.activeFrom <= now) &&
        (!p.activeTo || p.activeTo >= now),
    );
    if (active.length === 0) return { ...EMPTY };

    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, appCategoryId: true },
    });
    const catById = new Map(products.map((p) => [p.id, p.appCategoryId]));

    const result: PromoResult = {
      gifts: [],
      giftValue: 0,
      moneyDiscount: 0,
      freeDelivery: false,
      applied: [],
      appliedPromotions: [],
      nextGift: null,
    };

    for (const promo of active) {
      if (!(await this.isAllowed(promo, context))) continue;

      const before = result.moneyDiscount + result.giftValue;
      switch (promo.kind) {
        case 'GIFT_FOR_QTY':
          await this.applyGiftForQty(promo, items, catById, result);
          break;
        case 'GIFT_FOR_SUM':
          await this.applyGiftForSum(promo, context, result);
          break;
        case 'PERCENT_OFF':
        case 'FIXED_OFF':
          this.applyMoneyDiscount(promo, context, result);
          break;
        case 'FREE_DELIVERY':
          if (context.orderType === 'PICKUP') break;
          result.freeDelivery = true;
          this.markApplied(promo, 0, result);
          break;
      }
      const gained = result.moneyDiscount + result.giftValue - before;
      // Акция, которая ничего не дала, не должна светиться в списке
      // применённых и тратить лимит клиента.
      if (
        gained === 0 &&
        promo.kind !== 'FREE_DELIVERY' &&
        result.appliedPromotions.at(-1)?.id === promo.id
      ) {
        result.appliedPromotions.pop();
        result.applied.pop();
      }
    }

    result.nextGift = await this.nearestGift(active, context, result);
    return result;
  }

  /**
   * До какой акции на сумму человеку не хватило немного.
   *
   * Показываем только **ближайшую** и только если подарок ещё не получен:
   * список «до чего вам не хватило» превращает корзину в рекламный щит,
   * а один конкретный шаг человек действительно делает.
   */
  private async nearestGift(
    active: Promotion[],
    context: PromoContext,
    result: PromoResult,
  ) {
    const candidates = active
      .filter(
        (promo) =>
          promo.kind === 'GIFT_FOR_SUM' &&
          promo.minOrderSum != null &&
          promo.minOrderSum > context.subtotal &&
          promo.giftProductId != null &&
          // Акцию, подарок по которой уже в корзине, не предлагаем снова
          !result.gifts.some((g) => g.promotionId === promo.id),
      )
      .sort((a, b) => (a.minOrderSum ?? 0) - (b.minOrderSum ?? 0));

    const promo = candidates[0];
    if (!promo?.giftProductId || promo.minOrderSum == null) return null;

    const gift = await this.prisma.product.findUnique({
      where: { id: promo.giftProductId },
      select: {
        name: true,
        displayName: true,
        isActive: true,
        category: { select: { isActive: true } },
      },
    });
    // Обещать подарок, которого сегодня нет в кассе, нельзя
    if (!gift?.isActive || !gift.category.isActive) return null;

    return {
      name: promo.name,
      missing: promo.minOrderSum - context.subtotal,
      giftName: gift.displayName ?? gift.name,
    };
  }

  /** Ограничения акции: тип заказа, порог суммы, лимиты применений */
  private async isAllowed(
    promo: Promotion,
    context: PromoContext,
  ): Promise<boolean> {
    if (promo.orderType && context.orderType && promo.orderType !== context.orderType) {
      return false;
    }
    if (promo.minOrderSum != null && context.subtotal < promo.minOrderSum) {
      return false;
    }
    // «Только первый заказ» без входа проверить нельзя: гость каждый раз
    // выглядел бы новым клиентом, и акция раздавалась бы бесконечно.
    if (promo.firstOrderOnly) {
      if (!context.customerId || !context.isFirstOrder) return false;
    }
    const ownUses = context.excludeOrderId
      ? { orderId: { not: context.excludeOrderId } }
      : {};
    if (promo.totalLimit != null) {
      const total = await this.prisma.promotionUse.count({
        where: { promotionId: promo.id, ...ownUses },
      });
      if (total >= promo.totalLimit) return false;
    }
    if (promo.perCustomerLimit != null) {
      if (!context.customerId) return false;
      const mine = await this.prisma.promotionUse.count({
        where: {
          promotionId: promo.id,
          customerId: context.customerId,
          ...ownUses,
        },
      });
      if (mine >= promo.perCustomerLimit) return false;
    }
    return true;
  }

  private markApplied(promo: Promotion, discount: number, result: PromoResult) {
    result.applied.push(promo.name);
    result.appliedPromotions.push({
      id: promo.id,
      name: promo.name,
      discount,
    });
  }

  private async applyGiftForQty(
    promo: Promotion,
    items: CartItemInput[],
    catById: Map<string, string | null>,
    result: PromoResult,
  ) {
    if (!promo.conditionCategoryId) return;
    const qtyInCategory = items.reduce(
      (sum, i) =>
        catById.get(i.productId) === promo.conditionCategoryId
          ? sum + i.qty
          : sum,
      0,
    );
    const times = promo.repeatPerCart
      ? Math.floor(qtyInCategory / promo.conditionQty)
      : qtyInCategory >= promo.conditionQty
        ? 1
        : 0;
    if (times === 0) return;
    await this.addGift(promo, times * promo.giftQty, result);
  }

  private async applyGiftForSum(
    promo: Promotion,
    context: PromoContext,
    result: PromoResult,
  ) {
    // Порог уже проверен в isAllowed через minOrderSum
    if (promo.minOrderSum == null) return;
    await this.addGift(promo, promo.giftQty, result);
  }

  private async addGift(
    promo: Promotion,
    qty: number,
    result: PromoResult,
  ) {
    if (!promo.giftProductId || qty <= 0) return;
    const gift = await this.prisma.product.findUnique({
      where: { id: promo.giftProductId },
      include: { category: true, posterAccount: true },
    });
    // Подарок должен быть доступен в кассе, иначе акцию пропускаем:
    // обещать позицию, которой нет, хуже, чем не обещать вовсе.
    if (
      !gift ||
      !gift.isActive ||
      !gift.category.isActive ||
      !gift.posterAccount.isActive
    ) {
      return;
    }

    const price = gift.priceOverride ?? gift.price;
    result.gifts.push({
      productId: gift.id,
      name: gift.displayName ?? gift.name,
      price,
      qty,
      promotionId: promo.id,
      promotionName: promo.name,
    });
    result.giftValue += price * qty;
    this.markApplied(promo, price * qty, result);
  }

  private applyMoneyDiscount(
    promo: Promotion,
    context: PromoContext,
    result: PromoResult,
  ) {
    if (promo.discountValue <= 0) return;

    let discount =
      promo.kind === 'PERCENT_OFF'
        ? Math.floor((context.subtotal * promo.discountValue) / 100)
        : promo.discountValue;

    // Потолок процента: без него «−50%» на крупном заказе уносит выручку.
    if (promo.maxDiscount != null) {
      discount = Math.min(discount, promo.maxDiscount);
    }
    // Скидка не может превысить сумму товаров — иначе заказ уходит в минус
    // и «Личная интеграция» в Poster перестаёт сходиться.
    const room = context.subtotal - result.moneyDiscount;
    discount = Math.max(0, Math.min(discount, room));
    if (discount === 0) return;

    result.moneyDiscount += discount;
    this.markApplied(promo, discount, result);
  }

  /**
   * Записывает применения акций к заказу.
   *
   * Ключ (promotionId, orderId) уникален: повторная отправка заказа не
   * должна удваивать счётчик и съедать лимит клиента.
   */
  async recordUses(
    tenantId: string,
    orderId: string,
    customerId: string | null,
    applied: { id: string; discount: number }[],
  ) {
    if (applied.length === 0) return;
    await this.prisma.promotionUse.createMany({
      data: applied.map((a) => ({
        tenantId,
        promotionId: a.id,
        orderId,
        customerId,
        discount: a.discount,
      })),
      skipDuplicates: true,
    });
  }

  /** Сколько раз сработала каждая акция и сколько это стоило */
  async report(tenantId: string, from: Date, to: Date) {
    const uses = await this.prisma.promotionUse.findMany({
      where: { tenantId, createdAt: { gte: from, lt: to } },
      include: { promotion: { select: { name: true, kind: true } } },
    });
    const byPromo = new Map<
      string,
      { name: string; kind: PromotionKind; count: number; discount: number }
    >();
    for (const use of uses) {
      const row = byPromo.get(use.promotionId) ?? {
        name: use.promotion.name,
        kind: use.promotion.kind,
        count: 0,
        discount: 0,
      };
      row.count += 1;
      row.discount += use.discount;
      byPromo.set(use.promotionId, row);
    }
    return {
      from,
      to,
      total: uses.length,
      totalDiscount: uses.reduce((s, u) => s + u.discount, 0),
      byPromotion: [...byPromo.values()].sort((a, b) => b.count - a.count),
    };
  }
}
