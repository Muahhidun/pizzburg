import { Injectable } from '@nestjs/common';
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

/**
 * Промо-движок приложения. Правила living в нашей БД (повторяют акции
 * Poster). Визуализация выгоды — в корзине (подарок появляется сам),
 * сходимость — через «Личную интеграцию» при отправке заказа.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Считает подарки для корзины. promoCode передаётся, если клиент ввёл
   * код; акции с code=null применяются автоматически.
   */
  async evaluate(
    tenantId: string,
    items: CartItemInput[],
    promoCode?: string,
  ): Promise<{ gifts: GiftLine[]; discount: number; applied: string[] }> {
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
    if (active.length === 0) return { gifts: [], discount: 0, applied: [] };

    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, appCategoryId: true },
    });
    const catById = new Map(products.map((p) => [p.id, p.appCategoryId]));

    const gifts: GiftLine[] = [];
    const applied: string[] = [];
    let discount = 0;

    for (const promo of active) {
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
      if (times === 0) continue;

      const gift = await this.prisma.product.findUnique({
        where: { id: promo.giftProductId },
        include: { category: true, posterAccount: true },
      });
      // подарок должен быть доступен в кассе, иначе акцию пропускаем
      if (
        !gift ||
        !gift.isActive ||
        !gift.category.isActive ||
        !gift.posterAccount.isActive
      )
        continue;

      const qty = times * promo.giftQty;
      const price = gift.priceOverride ?? gift.price;
      gifts.push({
        productId: gift.id,
        name: gift.displayName ?? gift.name,
        price,
        qty,
        promotionId: promo.id,
        promotionName: promo.name,
      });
      discount += price * qty;
      applied.push(promo.name);
    }

    return { gifts, discount, applied };
  }
}
