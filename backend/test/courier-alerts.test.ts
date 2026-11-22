import assert from 'node:assert/strict';
import test from 'node:test';
import { orderClockStart, taskAlert } from '../src/couriers/courier-alerts.service';
import { COURIER_DEFAULTS } from '../src/couriers/courier-settings';

const NOW = new Date('2026-11-23T13:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const task = (over: Partial<Parameters<typeof taskAlert>[0]> = {}) => ({
  kind: 'DELIVERY' as const,
  status: 'NEW' as const,
  createdAt: ago(10),
  pickedUpAt: null,
  order: { createdAt: ago(10), scheduledAt: null },
  ...over,
});
const none = { waitingCouriers: 0, firstWaitingSince: null };

test('заказу 40 минут и курьеров в очереди нет — «нет курьера»', () => {
  const t = task({ status: 'READY', order: { createdAt: ago(41), scheduledAt: null } });
  assert.equal(taskAlert(t, none, COURIER_DEFAULTS, NOW), 'NO_COURIER');
  assert.equal(taskAlert(t, { waitingCouriers: 1, firstWaitingSince: ago(1) }, COURIER_DEFAULTS, NOW), null);
});

test('курьер ждёт 25 минут, а заказ в «Новом» — «курьер ждёт»; отсчёт от позднего', () => {
  const t = task({ createdAt: ago(60), order: { createdAt: ago(60), scheduledAt: null } });
  assert.equal(taskAlert(t, { waitingCouriers: 1, firstWaitingSince: ago(26) }, COURIER_DEFAULTS, NOW), 'NOT_READY');
  // Курьер пришёл 5 минут назад — ещё рано, хоть заказу и час
  assert.equal(taskAlert(t, { waitingCouriers: 1, firstWaitingSince: ago(5) }, COURIER_DEFAULTS, NOW), null);
});

test('в пути больше 20 минут — «долго в пути»', () => {
  assert.equal(taskAlert(task({ status: 'PICKED_UP', pickedUpAt: ago(21) }), none, COURIER_DEFAULTS, NOW), 'ON_WAY');
  assert.equal(taskAlert(task({ status: 'PICKED_UP', pickedUpAt: ago(10) }), none, COURIER_DEFAULTS, NOW), null);
});

test('курьер ждёт без заказов и самовывоз тревог не дают', () => {
  assert.equal(taskAlert(task({ kind: 'PICKUP', order: { createdAt: ago(90), scheduledAt: null } }), none, COURIER_DEFAULTS, NOW), null);
});

test('предзаказ считается оформленным за час до нужного времени', () => {
  const order = { createdAt: ago(300), scheduledAt: new Date(NOW.getTime() + 30 * 60_000) };
  assert.equal(orderClockStart(order).getTime(), ago(30).getTime());
  assert.equal(taskAlert(task({ status: 'READY', order }), none, COURIER_DEFAULTS, NOW), null);
  const soon = { createdAt: ago(300), scheduledAt: new Date(NOW.getTime() - 5 * 60_000) };
  assert.equal(taskAlert(task({ status: 'READY', order: soon }), none, COURIER_DEFAULTS, NOW), 'NO_COURIER');
});
