import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailySummary,
  localDayStart,
} from '../src/orders/daily-summary.service';
import { moneyLine } from '../src/orders/orders.service';

test('начало дня считается по времени заведения, а не сервера', () => {
  // 21:30 в Экибастузе (UTC+5) = 16:30 UTC; полночь там = 19:00 UTC накануне
  const start = localDayStart(new Date('2026-11-13T16:30:00Z'), 'Asia/Almaty');
  assert.equal(start.toISOString(), '2026-11-12T19:00:00.000Z');
});

test('в строке отмены видно, что сделали с деньгами Kaspi', () => {
  const base = { paymentMethod: 'KASPI_ONLINE', paidAt: new Date(), total: 5000 };
  assert.match(moneyLine({ ...base, paymentRefunds: [] }), /не возвращали/);
  assert.match(
    moneyLine({ ...base, paymentRefunds: [{ amount: 5000, idempotencyKey: 'order-cancel:o1' }] }),
    /полностью/,
  );
  assert.match(
    moneyLine({ ...base, paymentRefunds: [{ amount: 1200, idempotencyKey: 'order-cancel:o1' }] }),
    /1200 ₸ из 5000 ₸.*частично/,
  );
  assert.equal(moneyLine({ paymentMethod: 'CASH', total: 3000 }), '');
});

test('сводка дня собирает заказы, отмены и возвраты', () => {
  const text = buildDailySummary(
    [
      { number: 1, status: 'DELIVERED', total: 4000, paymentMethod: 'CASH', paidAt: null, cancelledBy: null, cancelReason: null, paymentRefunds: [] },
      { number: 2, status: 'DELIVERED', total: 6000, paymentMethod: 'KASPI_ONLINE', paidAt: new Date(), cancelledBy: null, cancelReason: null, paymentRefunds: [] },
      { number: 3, status: 'CANCELLED', total: 5000, paymentMethod: 'KASPI_ONLINE', paidAt: new Date(), cancelledBy: 'ADMIN', cancelReason: 'Нет <курьеров>', paymentRefunds: [{ amount: 5000, idempotencyKey: 'order-cancel:3' }] },
      { number: 4, status: 'CANCELLED', total: 2000, paymentMethod: 'KASPI_ONLINE', paidAt: null, cancelledBy: 'SYSTEM', cancelReason: 'Не оплачен', paymentRefunds: [] },
    ],
    [
      { amount: 5000, status: 'SUCCEEDED', order: { number: 3 } },
      { amount: 700, status: 'FAILED', order: { number: 9 } },
    ],
    '13 ноября',
  );
  assert.match(text, /Заказов: 2 на 10000 ₸ \(Kaspi онлайн: 1\)/);
  assert.match(text, /Отмен: 2/);
  assert.match(text, /кассир — 1/);
  assert.match(text, /Нет &lt;курьеров&gt;/);
  assert.match(text, /Вернули: 1 на 5000 ₸/);
  assert.match(text, /Повторить.*№9 \(700 ₸\)/);
});
