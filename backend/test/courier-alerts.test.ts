import assert from 'node:assert/strict';
import test from 'node:test';
import { alertOutcome, CourierAlertsService, orderClockStart, taskAlert } from '../src/couriers/courier-alerts.service';
import { telNumber } from '../src/couriers/task-order';
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

// ─── Итог тревоги ────────────────────────────────────────────────────

const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 23, h - 5, m)); // время Экибастуза
const done = (over: Partial<Parameters<typeof alertOutcome>[1]> = {}) => ({
  status: 'NEW' as const,
  readyAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  order: { createdAt: at(18, 0), scheduledAt: null },
  courier: { fullName: 'Әбенов Марлен' },
  ...over,
});

test('итог тревоги: забрали, доставлен, готов, отменён; пока идёт — пусто', () => {
  assert.equal(alertOutcome('NO_COURIER', done({ status: 'READY' })), null);
  assert.equal(alertOutcome('NO_COURIER', done({ status: 'ASSIGNED' as any })), null);
  assert.equal(
    alertOutcome('NO_COURIER', done({ status: 'PICKED_UP' as any, pickedUpAt: at(18, 52) })),
    '✅ Марлен Ә. забрал в 18:52, заказу было 52 мин',
  );
  assert.equal(alertOutcome('ON_WAY', done({ status: 'PICKED_UP' as any, pickedUpAt: at(18, 52) })), null);
  assert.equal(
    alertOutcome('ON_WAY', done({ status: 'DELIVERED' as any, pickedUpAt: at(18, 52), deliveredAt: at(19, 20) })),
    '✅ Доставлен в 19:20, в пути 28 мин, всего 80 мин',
  );
  assert.equal(alertOutcome('NOT_READY', done({ status: 'READY', readyAt: at(18, 30) })), '✅ Готов в 18:30');
  assert.equal(alertOutcome('ON_WAY', done({ status: 'CANCELLED' as any })), '✖️ Заказ отменён');
  assert.equal(
    alertOutcome('ON_WAY', done({ status: 'FAILED' as any, failedReason: 'Клиент не отвечает' })),
    '❌ Не доставлен: Клиент не отвечает',
  );
});

test('итог дописывается в оба сообщения тревоги один раз', async () => {
  const calls: any[] = [];
  const updates: any[] = [];
  const event = {
    id: 'e1',
    tenantId: 't',
    type: 'ALERT_ON_WAY',
    meta: {
      text: '🐢 <b>№1431 в пути уже 20 мин</b>',
      messages: [
        { chatId: '-100cash', messageId: 10 },
        { chatId: '-100own', messageId: 20 },
      ],
    } as any,
    task: {
      ...done({ status: 'DELIVERED' as any, pickedUpAt: at(18, 52), deliveredAt: at(19, 20) }),
      order: { number: 1431, createdAt: at(18, 0), scheduledAt: null },
    },
  };
  const prisma: any = {
    deliveryTaskEvent: {
      findMany: async () => [event],
      update: async ({ data }: any) => (updates.push(data), Object.assign(event, data)),
    },
  };
  const telegram: any = { call: async (_t: string, method: string, p: any) => (calls.push({ method, ...p }), { error: null }) };
  const s = new CourierAlertsService(prisma, telegram);
  assert.equal(await s.resolve(at(19, 21)), 1);
  assert.deepEqual(calls.map((c) => [c.method, c.chat_id, c.message_id]), [
    ['editMessageText', '-100cash', 10],
    ['editMessageText', '-100own', 20],
  ]);
  assert.equal(calls[0].text, '🐢 <b>№1431 в пути уже 20 мин</b>\n\n✅ Доставлен в 19:20, в пути 28 мин, всего 80 мин');
  assert.ok(updates[0].meta.resolvedAt);
  // Второй проход ничего не правит
  assert.equal(await s.resolve(at(19, 22)), 0);
  assert.equal(calls.length, 2);
});

test('номер для звонка: только плюс и цифры', () => {
  assert.equal(telNumber('+7 705 866 33 23'), '+77058663323');
  assert.equal(telNumber('8 (705) 866-33-23'), '+77058663323');
  assert.equal(telNumber('77058663323'), '+77058663323');
  assert.equal(telNumber('+77768147963'), '+77768147963');
});

test('связка: о втором заказе тревога позже — его везут после первого', () => {
  const first = task({ status: 'PICKED_UP', pickedUpAt: ago(21), batchSeq: 1 });
  const second = task({ status: 'PICKED_UP', pickedUpAt: ago(21), batchSeq: 2 });
  assert.equal(taskAlert(first, none, COURIER_DEFAULTS, NOW), 'ON_WAY');
  assert.equal(taskAlert(second, none, COURIER_DEFAULTS, NOW), null);
  assert.equal(taskAlert({ ...second, pickedUpAt: ago(30) }, none, COURIER_DEFAULTS, NOW), 'ON_WAY');
});

test('долго в пути: курьеру приходит напоминание протянуть «Доставлен»', async () => {
  const sent: string[] = [];
  const prisma: any = {
    dispatchDevice: { findMany: async () => [{ venueId: 'v', tenantId: 't', tenant: { settings: {} } }] },
    courierShift: { findMany: async () => [] },
    deliveryTask: {
      findMany: async () => [
        {
          id: 'k', kind: 'DELIVERY', status: 'PICKED_UP', createdAt: ago(40), pickedUpAt: ago(21), batchSeq: null,
          order: { number: 1492, createdAt: ago(40), scheduledAt: null },
          courier: { fullName: 'Әбенов Марлен', phone: '+7', telegramUserId: '555' },
        },
      ],
    },
    deliveryTaskEvent: {
      findFirst: async () => null,
      create: async () => ({ id: 'e' }),
      update: async () => ({}),
    },
  };
  const telegram: any = {
    linkOrders: async (_t: string, text: string) => text,
    notifyCashier: async () => ({ sent: false }),
    notify: async () => ({ sent: false }),
  };
  const assignment: any = { sendToCourier: async (_t: string, chat: string, text: string) => sent.push(`${chat}:${text}`) };
  const s = new CourierAlertsService(prisma, telegram, assignment);
  assert.equal(await s.check(NOW), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^555:⏰ <b>№1492: вы уже долго в пути/);
});

import { CourierAppService } from '../src/couriers/courier-app.service';

function reminderWorld(status = 'PICKED_UP') {
  const calls: any[] = [];
  const notes: string[] = [];
  const delivered: string[] = [];
  const events: string[] = [];
  const prisma: any = {
    courier: {
      findUnique: async () => ({ id: 'c1', status: 'ACTIVE', fullName: 'Әбенов Марлен', tenant: { slug: 'pb', settings: {} } }),
    },
    deliveryTask: { findFirst: async () => ({ id: 'k', status, order: { number: 1492 } }) },
    deliveryTaskEvent: { create: async ({ data }: any) => (events.push(data.type), data) },
  };
  const telegram: any = { call: async (_t: string, method: string, p: any) => (calls.push({ method, ...p }), { error: null }) };
  const alerts: any = { noteCourierReply: async (_id: string, line: string) => notes.push(line) };
  const svc = new CourierAppService(prisma, telegram, {} as any, {} as any, {} as any, {} as any, {} as any, undefined, alerts);
  (svc as any).delivered = async (_a: unknown, id: string) => delivered.push(id);
  (svc as any).me = async () => ({});
  const press = (data: string) =>
    svc.onTelegram('t', {
      callback_query: { id: 'q', from: { id: 555 }, data, message: { message_id: 7, chat: { id: 555 }, text: '⏰ №1492: вы уже долго в пути' } },
    });
  return { calls, notes, delivered, events, press };
}

test('напоминание: «Ещё везу» — пометка курьеру и под тревогой в группе', async () => {
  const w = reminderWorld();
  assert.equal(await w.press('dv:w:k'), true);
  assert.equal(w.delivered.length, 0);
  assert.match(w.notes[0], /^🚗 Курьер ответил: ещё везу \(\d\d:\d\d\)$/);
  // Ответ запомнили: в приложении вопрос больше не висит
  assert.deepEqual(w.events, ['STILL_ON_WAY']);
  const edit = w.calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.text, /🚗 Вы ответили: ещё везу/);
});

test('напоминание: «Уже отдал» — заказ доставлен из чата', async () => {
  const w = reminderWorld();
  await w.press('dv:d:k');
  assert.deepEqual(w.delivered, ['k']);
  assert.match(w.calls.find((c) => c.method === 'editMessageText').text, /✅ Отмечено: №1492 доставлен/);
  // Уже доставлен в приложении — ничего не делаем
  const done = reminderWorld('DELIVERED');
  await done.press('dv:d:k');
  assert.equal(done.delivered.length, 0);
  // Чужие кнопки не трогаем
  assert.equal(await w.press('cash:x'), false);
});
