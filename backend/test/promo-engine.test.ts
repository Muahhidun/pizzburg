import assert from 'node:assert/strict';
import test from 'node:test';
import { PromotionsService } from '../src/promotions/promotions.service';

/**
 * Промо-движок v2.
 *
 * Главное, что здесь проверяется, — не «сработала ли акция», а денежные
 * инварианты: скидка не должна превышать сумму товаров и не должна
 * молча уходить в минус. От этого зависит сходимость смены: всё, что
 * клиент не заплатил, гасится «Личной интеграцией» в Poster.
 */

type PromoRow = Record<string, unknown>;

function serviceWith(
  promos: PromoRow[],
  options: { gift?: Record<string, unknown> | null; uses?: number } = {},
) {
  const created: Record<string, unknown>[] = [];
  const gift =
    options.gift === undefined
      ? {
          id: 'gift-1',
          name: 'Маргарита',
          displayName: null,
          price: 2550,
          priceOverride: null,
          isActive: true,
          category: { isActive: true },
          posterAccount: { isActive: true },
        }
      : options.gift;

  const prisma = {
    promotion: { findMany: async () => promos },
    product: {
      findMany: async () => [
        { id: 'p1', appCategoryId: 'cat-pizza' },
        { id: 'p2', appCategoryId: 'cat-pizza' },
        { id: 'p3', appCategoryId: 'cat-drinks' },
      ],
      findUnique: async () => gift,
    },
    promotionUse: {
      count: async () => options.uses ?? 0,
      createMany: async (args: Record<string, unknown>) => {
        created.push(args);
        return { count: 0 };
      },
    },
  };
  return { service: new PromotionsService(prisma as never), created };
}

const base = {
  id: 'promo-1',
  name: 'Тест',
  code: null,
  isActive: true,
  conditionCategoryId: null,
  conditionQty: 2,
  minOrderSum: null,
  giftProductId: null,
  giftQty: 1,
  discountValue: 0,
  maxDiscount: null,
  repeatPerCart: true,
  firstOrderOnly: false,
  perCustomerLimit: null,
  totalLimit: null,
  orderType: null,
  activeFrom: null,
  activeTo: null,
};

test('2+1: две пиццы дают один подарок', async () => {
  const { service } = serviceWith([
    {
      ...base,
      kind: 'GIFT_FOR_QTY',
      conditionCategoryId: 'cat-pizza',
      giftProductId: 'gift-1',
    },
  ]);

  const r = await service.evaluate('t1', [{ productId: 'p1', qty: 2 }], undefined, {
    subtotal: 6000,
  });

  assert.equal(r.gifts.length, 1);
  assert.equal(r.gifts[0].qty, 1);
  assert.equal(r.giftValue, 2550);
  // подарок НЕ уменьшает сумму к оплате
  assert.equal(r.moneyDiscount, 0);
});

test('процент считается от суммы товаров', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'PERCENT_OFF', discountValue: 20 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 5000 });

  assert.equal(r.moneyDiscount, 1000);
  assert.deepEqual(r.applied, ['Тест']);
});

test('потолок ограничивает процент — иначе −50% уносит выручку', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'PERCENT_OFF', discountValue: 50, maxDiscount: 1500 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 20000 });

  assert.equal(r.moneyDiscount, 1500);
});

test('скидка не может превысить сумму товаров', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'FIXED_OFF', discountValue: 9000 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 3000 });

  assert.equal(r.moneyDiscount, 3000, 'заказ не должен уходить в минус');
});

test('две скидки подряд вместе не превышают сумму заказа', async () => {
  const { service } = serviceWith([
    { ...base, id: 'a', name: 'A', kind: 'FIXED_OFF', discountValue: 2000 },
    { ...base, id: 'b', name: 'B', kind: 'FIXED_OFF', discountValue: 2000 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 3000 });

  assert.equal(r.moneyDiscount, 3000);
  assert.equal(r.appliedPromotions.length, 2);
  assert.equal(
    r.appliedPromotions.reduce((s, p) => s + p.discount, 0),
    3000,
    'сумма по акциям должна сходиться с итоговой скидкой',
  );
});

test('порог суммы не пускает акцию на маленький заказ', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'FIXED_OFF', discountValue: 500, minOrderSum: 5000 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 4999 });

  assert.equal(r.moneyDiscount, 0);
  assert.deepEqual(r.applied, []);
});

test('акция только для доставки не работает на самовывозе', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'FIXED_OFF', discountValue: 500, orderType: 'DELIVERY' },
  ]);

  const pickup = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    orderType: 'PICKUP',
  });
  const delivery = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    orderType: 'DELIVERY',
  });

  assert.equal(pickup.moneyDiscount, 0);
  assert.equal(delivery.moneyDiscount, 500);
});

test('«только первый заказ» не даётся гостю и повторному клиенту', async () => {
  const promo = { ...base, kind: 'FIXED_OFF', discountValue: 500, firstOrderOnly: true };

  const { service } = serviceWith([promo]);
  const guest = await service.evaluate('t1', [], undefined, { subtotal: 5000 });
  const repeat = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    customerId: 'c1',
    isFirstOrder: false,
  });
  const first = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    customerId: 'c1',
    isFirstOrder: true,
  });

  assert.equal(guest.moneyDiscount, 0, 'гость выглядит новым каждый раз');
  assert.equal(repeat.moneyDiscount, 0);
  assert.equal(first.moneyDiscount, 500);
});

test('исчерпанный лимит применений закрывает акцию', async () => {
  const { service } = serviceWith(
    [{ ...base, kind: 'FIXED_OFF', discountValue: 500, totalLimit: 100 }],
    { uses: 100 },
  );

  const r = await service.evaluate('t1', [], undefined, { subtotal: 5000 });

  assert.equal(r.moneyDiscount, 0);
});

test('лимит на клиента требует входа', async () => {
  const { service } = serviceWith(
    [{ ...base, kind: 'FIXED_OFF', discountValue: 500, perCustomerLimit: 1 }],
    { uses: 0 },
  );

  const guest = await service.evaluate('t1', [], undefined, { subtotal: 5000 });
  assert.equal(guest.moneyDiscount, 0);
});

test('недоступный подарок отменяет акцию целиком', async () => {
  const { service } = serviceWith(
    [
      {
        ...base,
        kind: 'GIFT_FOR_QTY',
        conditionCategoryId: 'cat-pizza',
        giftProductId: 'gift-1',
      },
    ],
    { gift: null },
  );

  const r = await service.evaluate('t1', [{ productId: 'p1', qty: 2 }], undefined, {
    subtotal: 6000,
  });

  assert.equal(r.gifts.length, 0);
  assert.deepEqual(r.applied, [], 'нельзя обещать подарок, которого нет');
});

test('бесплатная доставка не выдаётся при самовывозе', async () => {
  const { service } = serviceWith([{ ...base, kind: 'FREE_DELIVERY' }]);

  const pickup = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    orderType: 'PICKUP',
  });
  const delivery = await service.evaluate('t1', [], undefined, {
    subtotal: 5000,
    orderType: 'DELIVERY',
  });

  assert.equal(pickup.freeDelivery, false);
  assert.equal(delivery.freeDelivery, true);
});

test('нулевая скидка не засчитывается как применение', async () => {
  const { service } = serviceWith([
    { ...base, kind: 'PERCENT_OFF', discountValue: 20 },
  ]);

  const r = await service.evaluate('t1', [], undefined, { subtotal: 0 });

  assert.deepEqual(r.applied, []);
  assert.equal(r.appliedPromotions.length, 0);
});

test('повтор заказа не удваивает счётчик применений', async () => {
  const { service, created } = serviceWith([]);

  await service.recordUses('t1', 'order-1', 'c1', [
    { id: 'promo-1', discount: 500 },
  ]);

  assert.equal(created.length, 1);
  assert.equal(created[0].skipDuplicates, true);
});
