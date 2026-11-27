import assert from 'node:assert/strict';
import test from 'node:test';
import { PromotionsService } from '../src/promotions/promotions.service';

/**
 * Акции 4+1 и кола за крылья (Дом, 27.11.2026):
 * — бургеры: за 4 любых бургера пятым дарится самый дешёвый из заказанных;
 * — донеры: каждая позиция отдельно, 4 маленьких → пятый маленький,
 *   2 маленьких + 2 больших → ничего;
 * — «Крылышки - 24шт» → кола 1 л, две порции → две колы; 6 и 12 не в счёт.
 */

const menu: Record<string, { cat: string; price: number; name: string }> = {
  'mini-chicken': { cat: 'burgers', price: 850, name: 'Мини Бургер куриный' },
  chicken: { cat: 'burgers', price: 1290, name: 'Чикен бургер' },
  classic: { cat: 'burgers', price: 1590, name: 'Классический бургер' },
  double: { cat: 'burgers', price: 2490, name: 'Двойной бургер' },
  'doner-s': { cat: 'doner', price: 1090, name: 'Донер маленький' },
  'doner-l': { cat: 'doner', price: 1890, name: 'Донер большой' },
  'wings-12': { cat: 'wings', price: 3350, name: 'Крылышки - 12шт' },
  'wings-24': { cat: 'wings', price: 5850, name: 'Крылышки - 24шт' },
  'cola-1l': { cat: 'drinks', price: 750, name: 'Кока-Кола 1л' },
};

function serviceWith(promo: Record<string, unknown>, inactive: string[] = []) {
  const prisma = {
    promotion: { findMany: async () => [promo] },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          appCategoryId: menu[id].cat,
          price: menu[id].price,
          priceOverride: null,
        })),
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: menu[where.id].name,
        displayName: null,
        price: menu[where.id].price,
        priceOverride: null,
        isActive: !inactive.includes(where.id),
        category: { isActive: true },
        posterAccount: { isActive: true },
      }),
    },
    promotionUse: { count: async () => 0 },
  };
  return new PromotionsService(prisma as never);
}

const base = {
  id: 'promo',
  name: '4+1',
  kind: 'GIFT_FOR_QTY',
  code: null,
  isActive: true,
  conditionCategoryId: null,
  conditionProductId: null,
  conditionQty: 4,
  minOrderSum: null,
  giftProductId: null,
  giftQty: 1,
  giftMode: 'FIXED',
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

const burgers = { ...base, name: '4+1 Бургеры', conditionCategoryId: 'burgers', giftMode: 'CHEAPEST' };
const doners = { ...base, name: '4+1 Донеры', conditionCategoryId: 'doner', giftMode: 'SAME' };
const wings = {
  ...base,
  name: 'Кола за 24 крыла',
  conditionProductId: 'wings-24',
  conditionQty: 1,
  giftProductId: 'cola-1l',
};

const gifts = (r: { gifts: { productId: string; qty: number }[] }) =>
  r.gifts.map((g) => `${g.productId}×${g.qty}`).sort();

test('4 разных бургера — пятым самый дешёвый из них', async () => {
  const r = await serviceWith(burgers).evaluate('t', [
    { productId: 'mini-chicken', qty: 1 },
    { productId: 'chicken', qty: 1 },
    { productId: 'classic', qty: 1 },
    { productId: 'double', qty: 1 },
  ]);
  assert.deepEqual(gifts(r), ['mini-chicken×1']);
  assert.equal(r.giftValue, 850);
  assert.deepEqual(r.applied, ['4+1 Бургеры']);
});

test('3 бургера — подарка нет', async () => {
  const r = await serviceWith(burgers).evaluate('t', [
    { productId: 'chicken', qty: 2 },
    { productId: 'classic', qty: 1 },
  ]);
  assert.deepEqual(r.gifts, []);
  assert.deepEqual(r.applied, []);
});

test('8 бургеров — два самых дешёвых, в том числе из разных позиций', async () => {
  const r = await serviceWith(burgers).evaluate('t', [
    { productId: 'double', qty: 5 },
    { productId: 'mini-chicken', qty: 1 },
    { productId: 'classic', qty: 2 },
  ]);
  assert.deepEqual(gifts(r), ['classic×1', 'mini-chicken×1']);
  assert.equal(r.giftValue, 850 + 1590);
});

test('один бургер двумя строками (модификаторы) считается вместе', async () => {
  const r = await serviceWith(burgers).evaluate('t', [
    { productId: 'chicken', qty: 2 },
    { productId: 'chicken', qty: 2 },
  ]);
  assert.deepEqual(gifts(r), ['chicken×1']);
});

test('4 маленьких донера — пятый маленький', async () => {
  const r = await serviceWith(doners).evaluate('t', [{ productId: 'doner-s', qty: 4 }]);
  assert.deepEqual(gifts(r), ['doner-s×1']);
});

test('4 больших донера — пятый большой', async () => {
  const r = await serviceWith(doners).evaluate('t', [{ productId: 'doner-l', qty: 4 }]);
  assert.deepEqual(gifts(r), ['doner-l×1']);
  assert.equal(r.giftValue, 1890);
});

test('2 маленьких и 2 больших донера — подарка нет', async () => {
  const r = await serviceWith(doners).evaluate('t', [
    { productId: 'doner-s', qty: 2 },
    { productId: 'doner-l', qty: 2 },
  ]);
  assert.deepEqual(r.gifts, []);
  assert.deepEqual(r.applied, []);
});

test('4 маленьких и 4 больших донера — по подарку каждого, акция записана один раз', async () => {
  const r = await serviceWith(doners).evaluate('t', [
    { productId: 'doner-s', qty: 4 },
    { productId: 'doner-l', qty: 4 },
  ]);
  assert.deepEqual(gifts(r), ['doner-l×1', 'doner-s×1']);
  assert.equal(r.appliedPromotions.length, 1);
  assert.equal(r.appliedPromotions[0].discount, 1090 + 1890);
});

test('Крылышки 24 шт → кола 1 л, две порции → две колы', async () => {
  const one = await serviceWith(wings).evaluate('t', [{ productId: 'wings-24', qty: 1 }]);
  assert.deepEqual(gifts(one), ['cola-1l×1']);
  const two = await serviceWith(wings).evaluate('t', [{ productId: 'wings-24', qty: 2 }]);
  assert.deepEqual(gifts(two), ['cola-1l×2']);
});

test('2 × «Крылышки - 12шт» колу не дают', async () => {
  const r = await serviceWith(wings).evaluate('t', [{ productId: 'wings-12', qty: 2 }]);
  assert.deepEqual(r.gifts, []);
});

test('подарок в стопе — акция не срабатывает целиком', async () => {
  const r = await serviceWith(doners, ['doner-l']).evaluate('t', [
    { productId: 'doner-s', qty: 4 },
    { productId: 'doner-l', qty: 4 },
  ]);
  assert.deepEqual(r.gifts, []);
  assert.equal(r.giftValue, 0);
  assert.deepEqual(r.applied, []);
});
