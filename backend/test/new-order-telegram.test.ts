import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOrderMessage } from '../src/orders/orders.service';

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
  assert.match(text, /К оплате: 5290 ₸<\/b> · наличные, сдача с 10000 ₸/);
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
  assert.match(text, /карта/);
});
