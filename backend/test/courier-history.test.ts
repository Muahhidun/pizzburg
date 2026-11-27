import assert from 'node:assert/strict';
import test from 'node:test';
import { cashStates, historyRows, shiftStats, shortAddress, timelineRows } from '../src/couriers/courier-history';
import { changeCheck } from '../src/couriers/courier-app.service';

/**
 * История смены курьера (Дом, 27.11.2026): заказы для сверки без данных
 * клиента, наличные с отметкой «сдано / на руках», хронология смены.
 */

const at = (hm: string) => new Date(`2026-11-27T${hm}:00+05:00`);

const ourTask = (id: string, number: number, payment: string, total: number, deliveredAt = at('12:00')) => ({
  id,
  kind: 'DELIVERY',
  status: 'DELIVERED',
  deliveredAt,
  updatedAt: deliveredAt,
  extraReason: null,
  external: null,
  order: {
    number,
    total,
    paymentMethod: payment,
    address: { street: 'улица Мухтара Ауэзова', house: '83', flat: '110', entrance: '5', comment: 'код 12' },
    items: [{ id: 'i1', name: 'BBQ Бургер', qty: 2, modifiers: [], isGift: false, isUnavailable: false }],
  },
});

const entry = (taskId: string, type: string, amount: number, status = 'CONFIRMED', paidBy: string | null = null) => ({
  taskId,
  type,
  status,
  amount,
  paidBy,
});

test('адрес — только улица и дом, без квартиры, подъезда и комментария', () => {
  assert.equal(shortAddress({ street: 'улица Мухтара Ауэзова', house: '83', flat: '110', comment: 'код' }), 'улица Мухтара Ауэзова, 83');
  assert.equal(shortAddress(null), '—');
});

test('в истории нет телефона и имени клиента', () => {
  const [row] = historyRows([ourTask('t1', 351, 'CASH', 6920)], [entry('t1', 'COLLECTED', 6920)], 6920);
  const json = JSON.stringify(row);
  assert.ok(!json.includes('110'), 'квартира не должна попасть в историю');
  assert.ok(!json.includes('код'), 'комментарий не должен попасть в историю');
  assert.deepEqual(Object.keys(row).sort(), ['address', 'at', 'cash', 'id', 'items', 'number', 'payment', 'status', 'total']);
});

test('№351: заказ 6 920 + сдача 3 080 — сдать 10 000, пока на руках', () => {
  const [row] = historyRows(
    [ourTask('t1', 351, 'CASH', 6920)],
    [entry('t1', 'COLLECTED', 6920), entry('t1', 'CHANGE_FLOAT', 3080)],
    10_000,
  );
  assert.deepEqual(row.cash, { order: 6920, change: 3080, owed: 10_000, state: 'ON_HAND', paidOtherwise: null });
  assert.equal(row.payment, 'Наличные');
  assert.equal(row.items, '2× BBQ Бургер');
});

test('сдал кассиру — старые заказы «сдано», последние «на руках»', () => {
  const rows = historyRows(
    [ourTask('new', 323, 'CASH', 11_930, at('17:25')), ourTask('old', 316, 'CASH', 7334, at('15:58'))],
    [entry('new', 'COLLECTED', 11_930), entry('old', 'COLLECTED', 7334)],
    11_930,
  );
  assert.deepEqual(rows.map((r) => r.cash?.state), ['ON_HAND', 'HANDED_IN']);
});

test('клиент заплатил картой, подтверждено — сдавать нечего', () => {
  const [row] = historyRows(
    [ourTask('t1', 310, 'CASH', 2940)],
    [entry('t1', 'COLLECTED', 2940), entry('t1', 'ADJUSTMENT', -2940, 'CONFIRMED', 'CARD')],
    0,
  );
  assert.equal(row.cash?.owed, 0);
  assert.deepEqual(row.cash?.paidOtherwise, { status: 'CONFIRMED', paidBy: 'CARD' });
});

test('оплата онлайн — без строки наличных', () => {
  const [row] = historyRows([ourTask('t1', 309, 'KASPI_ONLINE', 5000)], [], 0);
  assert.equal(row.cash, null);
  assert.equal(row.payment, 'Kaspi онлайн');
});

test('остаток на руках меньше заказа — «частично сдано»', () => {
  assert.deepEqual(cashStates([5000, 3000, 2000], 6000), ['ON_HAND', 'PARTLY', 'HANDED_IN']);
  assert.deepEqual(cashStates([5000], -9176), ['HANDED_IN']);
});

const ev = (type: string, hm: string, number?: number) => ({
  type,
  at: at(hm),
  meta: null,
  task: number ? { order: { number }, external: null } : null,
});

test('хронология: заступил, забрал, отвёз с минутами в пути, пауза', () => {
  const rows = timelineRows([
    ev('CHECK_IN', '11:00'),
    ev('ASSIGNED', '11:05', 306),
    ev('PICKED_UP', '11:10', 306),
    ev('DELIVERED', '11:32', 306),
    ev('PAUSE_START', '11:40'),
    ev('PAUSE_END', '11:55'),
    ev('CHECK_IN', '12:00'),
    ev('SHIFT_END', '22:00'),
  ]);
  assert.deepEqual(rows.map((r) => r.text), [
    'Заступил на смену',
    'Назначен №306',
    'Забрал №306',
    'Отвёз №306, в пути 22 мин',
    'Пауза',
    'Конец паузы',
    'Вернулся к раздаче, в очереди',
    'Закончил смену',
  ]);
});

test('сводка: средние минуты у раздачи и в пути, паузы', () => {
  const stats = shiftStats(
    [
      { status: 'DELIVERED', assignedAt: at('11:05'), pickedUpAt: at('11:10'), deliveredAt: at('11:30') },
      { status: 'DELIVERED', assignedAt: at('12:00'), pickedUpAt: at('12:07'), deliveredAt: at('12:37') },
      { status: 'FAILED', assignedAt: at('13:00'), pickedUpAt: at('13:05'), deliveredAt: null },
    ],
    [
      { type: 'PAUSE_START', at: at('14:00') },
      { type: 'PAUSE_END', at: at('14:15') },
    ],
    at('15:00'),
  );
  assert.deepEqual(stats, { delivered: 2, failed: 1, avgOnWayMin: 25, avgAtVenueMin: 6, pauseMin: 15 });
});

test('галочка «Сдача 3 080 ₸» появляется только при сдаче из кассы', () => {
  // toLocaleString ставит неразрывный пробел между разрядами
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/\u00a0|\u202f/g, ' '));
  assert.deepEqual(plain(changeCheck('t1', 10_000, 6920)), [
    { id: 'change:t1', name: 'Сдача 3 080 ₸', qty: 1, note: 'пересчитайте: клиент даст 10 000 ₸' },
  ]);
  assert.deepEqual(changeCheck('t1', null, 6920), []);
  assert.deepEqual(changeCheck('t1', 6920, 6920), []);
  assert.deepEqual(changeCheck('t1', 10_000, 0), []);
});
