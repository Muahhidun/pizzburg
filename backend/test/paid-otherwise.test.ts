import assert from 'node:assert/strict';
import test from 'node:test';
import { CourierCashService } from '../src/couriers/courier-cash.service';

/**
 * «Клиент оплатил иначе» (25.11.2026): заказ был «за наличные», клиент
 * заплатил картой. Курьер отмечает, кассир подтверждает — только тогда
 * сумма снимается с курьера.
 */

function world() {
  const task: any = { id: 'k', cashToCollect: 5000, needsTerminal: false, external: { label: '4321' }, order: null };
  const entries: any[] = [
    { id: 'col', tenantId: 't', courierId: 'c1', taskId: 'k', type: 'COLLECTED', status: 'CONFIRMED', amount: 5000, createdAt: new Date() },
  ];
  const calls: any[] = [];
  const sent: string[] = [];
  const events: any[] = [];
  const courier: any = { id: 'c1', fullName: 'Иван Петров', telegramUserId: 'tg1' };
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : v && typeof v === 'object' ? true : row[k] === v,
    );
  const prisma: any = {
    courierCashEntry: {
      findFirst: async ({ where }: any) => {
        const e = entries.find((x) => match(x, where));
        return e ? { ...e, task, courier } : null;
      },
      findMany: async ({ where }: any) => entries.filter((x) => match(x, where)).map((e) => ({ ...e, task })),
      create: async ({ data }: any) => {
        const e = { id: `e${entries.length}`, createdAt: new Date(), ...data };
        entries.push(e);
        return e;
      },
      update: async ({ where, data }: any) => Object.assign(entries.find((e) => e.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = entries.filter((e) => match(e, where));
        rows.forEach((e) => Object.assign(e, data));
        return { count: rows.length };
      },
      aggregate: async ({ where }: any) => ({
        _sum: { amount: entries.filter((e) => e.courierId === where.courierId && e.status === 'CONFIRMED').reduce((n, e) => n + e.amount, 0) },
      }),
    },
    deliveryTask: { update: async ({ data }: any) => Object.assign(task, data) },
    courierSettlement: { findFirst: async () => null },
    deliveryTaskEvent: { create: async ({ data }: any) => events.push(data) },
  };
  const telegram: any = {
    cashierTargetChat: async () => '-100',
    call: async (_t: string, method: string, body: any) => (calls.push({ method, body }), { result: { message_id: 7 } }),
  };
  const assignment: any = { sendToCourier: async (_t: string, chat: string, text: string) => sent.push(`${chat}: ${text}`) };
  const service = new CourierCashService(prisma, telegram, { register: () => undefined } as any, assignment);
  return { service, entries, calls, sent, events, task, courier };
}

test('курьер отмечает «картой» — кассиру карточка, долг пока на курьере', async () => {
  const w = world();
  await w.service.requestPaidOtherwise('t', w.courier, 'k', 'CARD');
  const adj = w.entries.find((e) => e.type === 'ADJUSTMENT');
  assert.equal(adj.status, 'PENDING');
  assert.equal(adj.amount, -5000);
  assert.equal(adj.paidBy, 'CARD');
  assert.equal(await w.service.balance('c1'), 5000);
  const card = w.calls.find((c) => c.method === 'sendMessage');
  assert.match(card.body.text, /№4321 оплачен картой через терминал/);
  assert.deepEqual(
    card.body.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data),
    [`pay:ok:${adj.id}`, `pay:no:${adj.id}`],
  );
  // Второй раз, пока кассир не ответил, — нельзя
  await assert.rejects(w.service.requestPaidOtherwise('t', w.courier, 'k', 'KASPI'), /Уже отправлено/);
});

test('кассир подтвердил — сумма снята с курьера, заказ больше не «наличными»', async () => {
  const w = world();
  const adj = await w.service.requestPaidOtherwise('t', w.courier, 'k', 'CARD');
  assert.equal(await w.service.resolvePaidOtherwise('t', adj.id, 'Кассир', true), true);
  assert.equal(await w.service.balance('c1'), 0);
  assert.equal(w.task.cashToCollect, 0);
  assert.equal(w.task.needsTerminal, true);
  assert.equal(w.events[0].type, 'PAYMENT_CHANGED');
  assert.match(w.sent.at(-1)!, /подтвердил.*На руках: 0/);
  // Повторное нажатие ничего не меняет
  assert.equal(await w.service.resolvePaidOtherwise('t', adj.id, 'Кассир', true), false);
});

test('кассир «были наличные» — долг остаётся, можно отметить заново', async () => {
  const w = world();
  const adj = await w.service.requestPaidOtherwise('t', w.courier, 'k', 'KASPI');
  await w.service.resolvePaidOtherwise('t', adj.id, 'Кассир', false);
  assert.equal(await w.service.balance('c1'), 5000);
  assert.equal(w.task.cashToCollect, 5000);
  assert.match(w.sent.at(-1)!, /не подтвердил.*остаются на вас/);
  const list = (await w.service.summary('c1')).cashOrders;
  assert.equal(list[0].paidOtherwise?.status, 'REJECTED');
});

test('без наличных по заказу отметить нельзя', async () => {
  const w = world();
  w.entries.length = 0;
  await assert.rejects(w.service.requestPaidOtherwise('t', w.courier, 'k', 'CARD'), /наличных на вас нет/);
});
