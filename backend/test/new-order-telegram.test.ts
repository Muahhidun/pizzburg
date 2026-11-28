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
  assert.match(text, /Доставка/);
  assert.match(text, /Ауэзова, 47Б, кв\. 12/);
  assert.match(text, /&lt;не работает&gt;/);
  assert.match(text, /Комбо Донер ×2\n {3}Sprite/);
  // Первые строки — номер, когда готовить и оплачен ли
  const [head, when, paid] = text.split('\n');
  assert.equal(head, '🆕 <b>Заказ №42</b> · 🚗 Доставка');
  assert.match(when, /СРАЗУ/);
  assert.match(
    paid,
    /НЕ ОПЛАЧЕН<\/b> · наличными, <b>положить сдачу 4710 ₸<\/b> \(у клиента 10000 ₸\)$/,
  );
  assert.match(text, /💰 <b>Сумма заказа: 5290 ₸<\/b>\n/);
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
  assert.match(text, /НЕ ОПЛАЧЕН<\/b> · картой через терминал$/m);
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
  const [, when, paid] = text.split('\n');
  assert.match(when, /ПРЕДЗАКАЗ — НА 19:30 \(21\.11\)/);
  assert.match(paid, /✅ <b>ОПЛАЧЕН<\/b> · Kaspi/);
  assert.match(text, /Сумма заказа: 5290 ₸<\/b> \(оплачено\)/);
});

test('предзаказ на завтра — кассир видит слово «ЗАВТРА», на сегодня — «СЕГОДНЯ»', () => {
  const at = new Date('2026-11-29T07:00:00Z'); // 12:00 29.11 по Алматы
  const msg = (now: string) =>
    newOrderMessage({ ...base, scheduledAt: at }, [], new Date(now)).split('\n')[1];
  assert.match(msg('2026-11-28T15:00:00Z'), /ПРЕДЗАКАЗ — НА ЗАВТРА, 12:00 \(29\.11\)/);
  assert.match(msg('2026-11-29T02:00:00Z'), /ПРЕДЗАКАЗ — НА СЕГОДНЯ, 12:00 \(29\.11\)/);
  // после полуночи по Алматы (19:30 UTC = 00:30) 29.11 — уже «сегодня»
  assert.match(msg('2026-11-28T19:30:00Z'), /НА СЕГОДНЯ, 12:00/);
});

test('комментарий чека: номер заказа первым, затем предзаказ и оплата, одной строкой', () => {
  const c = posterComment({
    number: 143,
    scheduledAt: new Date('2026-11-21T14:30:00Z'),
    tz: 'Asia/Almaty',
    pay: payStatus({ paymentMethod: 'CASH', type: 'DELIVERY', total: 4400, changeFrom: 10000 }),
    wish: 'без лука.',
    notes: ['', 'ПОДАРОК ПО АКЦИИ: Маргарита ×1 (оплачен интеграцией)'],
  });
  assert.equal(
    c,
    '===== ЗАКАЗ №143 ===== ' +
      '!!! ПРЕДЗАКАЗ НА 19:30 (21.11) !!! ' +
      'НЕ ОПЛАЧЕН, наличными. ПОЛОЖИТЬ СДАЧУ 5600 тг (у клиента 10000). ' +
      'ПОЖЕЛАНИЕ: без лука. ' +
      'ПОДАРОК ПО АКЦИИ: Маргарита x1 (оплачен интеграцией).',
  );
  // Без предзаказа за номером идёт оплата; сдача — только на первой части
  const c2 = posterComment({
    number: 7,
    scheduledAt: null,
    tz: 'Asia/Almaty',
    pay: payStatus({ paymentMethod: 'CASH', type: 'PICKUP', changeFrom: 5000 }, { withChange: false }),
  });
  assert.equal(c2, '===== ЗАКАЗ №7 ===== НЕ ОПЛАЧЕН, наличными.');
  // Картой при доставке — напомнить про терминал
  assert.equal(
    payStatus({ paymentMethod: 'CARD_ON_DELIVERY', type: 'DELIVERY' }).receipt,
    'НЕ ОПЛАЧЕН, картой через терминал',
  );
  // Купюра ровно на сумму — «без сдачи», а не «положить 0»
  assert.match(
    payStatus({ paymentMethod: 'CASH', type: 'DELIVERY', total: 5000, changeFrom: 5000 }).how,
    /, без сдачи$/,
  );
});
