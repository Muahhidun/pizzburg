import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOrderMessage, payStatus, posterComment } from '../src/orders/orders.service';

const base = {
  number: 42,
  type: 'DELIVERY',
  address: { street: 'Ауэзова', house: '47Б', flat: '12', comment: 'домофон <не работает>' },
  scheduledAt: null,
  comment: 'Без лука',
  total: 5290,
  deliveryFee: 500,
  pointsSpent: 0,
  promoDiscount: 0,
  paymentMethod: 'CASH',
  changeFrom: 10000,
  customer: { phone: '+77001112233', name: 'Тест' },
  tenant: { settings: {} },
};

test('сообщение о новом заказе: адрес, состав, оплата, экранирование', () => {
  const text = newOrderMessage(base, [
    { name: 'Комбо Донер', qty: 2, price: 2290, isGift: false, modifiers: [{ name: 'Sprite' }] },
  ]);
  assert.match(text, /заказ №42/);
  assert.match(text, /Доставка/);
  assert.match(text, /Ауэзова, 47Б, кв\. 12/);
  assert.match(text, /&lt;не работает&gt;/);
  assert.match(text, /Комбо Донер ×2\n {3}Sprite/);
  // Первые строки — когда готовить и оплачен ли
  const [when, paid] = text.split('\n');
  assert.match(when, /СРАЗУ/);
  assert.match(paid, /НЕ ОПЛАЧЕН<\/b> · наличные курьеру, сдача с 10000 ₸/);
  assert.match(text, /Взять с клиента: 5290 ₸/);
  assert.match(text, /Без лука/);
});

test('самовывоз без адреса', () => {
  const text = newOrderMessage(
    { ...base, type: 'PICKUP', address: null, comment: '', paymentMethod: 'CARD_ON_DELIVERY', changeFrom: null },
    [{ name: 'Пепси', qty: 1, price: 500, isGift: true, modifiers: [] }],
  );
  assert.match(text, /Самовывоз/);
  assert.doesNotMatch(text, /📍/);
  assert.match(text, /Пепси ×1 \(подарок\)/);
  assert.match(text, /НЕ ОПЛАЧЕН<\/b> · картой на кассе/);
});

test('предзаказ и оплата Kaspi — первыми строками', () => {
  const text = newOrderMessage(
    {
      ...base,
      paymentMethod: 'KASPI_ONLINE',
      changeFrom: null,
      // 19:30 по Алматы (UTC+5)
      scheduledAt: new Date('2026-11-21T14:30:00Z'),
    },
    [{ name: 'Пепси', qty: 1, price: 500, isGift: false, modifiers: [] }],
  );
  const [when, paid] = text.split('\n');
  assert.match(when, /ПРЕДЗАКАЗ — НА 19:30 \(21\.11\)/);
  assert.match(paid, /✅ <b>ОПЛАЧЕН<\/b> · Kaspi/);
  assert.match(text, /Сумма: 5290 ₸ \(оплачено\)/);
});

test('комментарий чека: предзаказ и оплата в начале, по строкам', () => {
  const c = posterComment({
    number: 143,
    scheduledAt: new Date('2026-11-21T14:30:00Z'),
    tz: 'Asia/Almaty',
    pay: payStatus({ paymentMethod: 'CASH', type: 'DELIVERY', changeFrom: 5000 }),
    wish: 'без лука',
    notes: ['', 'ОБЩИЙ ЗАКАЗ №143: часть 1/2 (Sunday)'],
  });
  assert.equal(
    c,
    '!!! ПРЕДЗАКАЗ НА 19:30 (21.11) !!!\n' +
      'НЕ ОПЛАЧЕН: наличные курьеру, сдача с 5000 ₸.\n' +
      '№143. ПОЖЕЛАНИЕ: без лука.\n' +
      'ОБЩИЙ ЗАКАЗ №143: часть 1/2 (Sunday).',
  );
  // Без предзаказа первой строкой идёт оплата; сдача — только на первой части
  const c2 = posterComment({
    number: 7,
    scheduledAt: null,
    tz: 'Asia/Almaty',
    pay: payStatus({ paymentMethod: 'CASH', type: 'PICKUP', changeFrom: 5000 }, { withChange: false }),
  });
  assert.equal(c2, 'НЕ ОПЛАЧЕН: наличные на кассе.\n№7.');
});
