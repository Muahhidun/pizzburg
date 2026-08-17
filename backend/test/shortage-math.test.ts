import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lineTotal,
  recalcAfterShortage,
  shrinkToOriginal,
} from '../src/orders/shortage-math';

/**
 * Пересчёт заказа после нехватки позиции (DECISIONS §12.9).
 *
 * Проверяем два обещания, данные клиенту: он не платит за то, чего не
 * привезли, и не платит больше, чем при оформлении. И одно обещание,
 * данное кассе: выгода не может вырасти из-за нашей же нехватки —
 * иначе «Личная интеграция» перестанет сходиться со сменой.
 */

const line = (price: number, qty = 1, modifiers?: { price: number }[]) => ({
  price,
  qty,
  modifiers: modifiers ?? [],
});

test('заказ без изменений пересчитывается сам в себя', () => {
  const result = recalcAfterShortage({
    remaining: [line(2500, 2), line(1200)],
    giftValue: 0,
    moneyDiscount: 0,
    deliveryFee: 800,
    pointsSpent: 0,
    originalTotal: 7000,
  });

  assert.equal(result.subtotal, 6200);
  assert.equal(result.total, 7000);
});

test('снятая позиция уходит из суммы вместе со своими модификаторами', () => {
  const result = recalcAfterShortage({
    remaining: [line(2500, 1, [{ price: 300 }])],
    giftValue: 0,
    moneyDiscount: 0,
    deliveryFee: 0,
    pointsSpent: 0,
    originalTotal: 9000,
  });

  assert.equal(lineTotal(line(2500, 2, [{ price: 300 }])), 5600);
  assert.equal(result.subtotal, 2800);
  assert.equal(result.total, 2800);
});

test('лишние баллы возвращаются, а не оплачивают несуществующую еду', () => {
  // Было: товаров на 5 000, списано 3 000 баллов. Осталось товаров на 2 000
  const result = recalcAfterShortage({
    remaining: [line(2000)],
    giftValue: 0,
    moneyDiscount: 0,
    deliveryFee: 0,
    pointsSpent: 3000,
    originalTotal: 2000,
  });

  assert.equal(result.pointsSpent, 2000);
  assert.equal(result.pointsRefund, 1000);
  assert.equal(result.total, 0);
  // Вся выгода одной строкой — ровно та сумма, что гасится интеграцией
  assert.equal(result.discount, 2000);
});

test('доставка не дорожает из-за того, что мы не собрали заказ', () => {
  // Порог бесплатной доставки перестал выполняться — счёт всё равно не
  // выставляем: нехватка наша, а не клиента
  const result = recalcAfterShortage({
    remaining: [line(1500)],
    giftValue: 0,
    moneyDiscount: 0,
    deliveryFee: 0,
    pointsSpent: 0,
    originalTotal: 12000,
  });

  assert.equal(result.deliveryFee, 0);
  assert.equal(result.total, 1500);
});

test('сумма к оплате никогда не превышает исходную', () => {
  const result = recalcAfterShortage({
    remaining: [line(4000)],
    giftValue: 0,
    moneyDiscount: 0,
    deliveryFee: 800,
    pointsSpent: 0,
    originalTotal: 3000,
  });

  assert.equal(result.total, 3000);
});

test('скидка не может превысить остаток товаров', () => {
  const result = recalcAfterShortage({
    remaining: [line(900)],
    giftValue: 0,
    moneyDiscount: 2000,
    deliveryFee: 0,
    pointsSpent: 0,
    originalTotal: 5000,
  });

  assert.equal(result.moneyDiscount, 900);
  assert.equal(result.total, 0);
});

test('подарок пропадает вместе с позицией-условием', () => {
  const kept = shrinkToOriginal(
    [],
    [{ productId: 'gift', qty: 1 }],
  );
  assert.deepEqual(kept, []);
});

test('подарок, которого в заказе не было, пересчёт не выдаёт', () => {
  // Клиент отказался от акции ради баллов (skipPromotions): вернуть ему
  // подарок «в утешение» — это расхождение по кассе
  const kept = shrinkToOriginal(
    [{ productId: 'roll', name: 'Ролл', price: 2000, qty: 1 }],
    [],
  );
  assert.deepEqual(kept, []);
});

test('уцелевший подарок остаётся, но не размножается', () => {
  const kept = shrinkToOriginal(
    [{ productId: 'roll', qty: 3 }],
    [{ productId: 'roll', qty: 1 }],
  );
  assert.deepEqual(kept, [{ productId: 'roll', qty: 1 }]);
});
