import assert from 'node:assert/strict';
import test from 'node:test';
import { DispatchBoardService } from '../src/couriers/dispatch-board.service';
import { buildDeliveryReport } from '../src/couriers/courier-report.service';

/**
 * Ручные статусы на планшете (25.11.2026): у планшета пропадал интернет,
 * курьеры забирали и отвозили заказы, а плитки так и висели «Новыми».
 */

function world(taskOver: Record<string, unknown> = {}) {
  const task: any = {
    id: 'k',
    tenantId: 't',
    venueId: 'v',
    kind: 'DELIVERY',
    status: 'NEW',
    source: 'POSTER',
    courierId: null,
    shiftId: null,
    batchId: null,
    readyAt: null,
    assignedAt: null,
    pickedUpAt: null,
    cashToCollect: 5000,
    external: { label: '4321', items: [], refs: [] },
    ...taskOver,
  };
  const shifts: any[] = [
    { id: 's1', tenantId: 't', venueId: 'v', courierId: 'c1', endedAt: null, state: 'WAITING', courier: { id: 'c1', telegramUserId: 'tg1' } },
    { id: 's2', tenantId: 't', venueId: 'v', courierId: 'c2', endedAt: null, state: 'ASSIGNED', courier: { id: 'c2', telegramUserId: 'tg2' } },
  ];
  const payouts: any[] = [];
  const cash: any[] = [];
  const events: any[] = [];
  const sent: string[] = [];
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v,
    );
  const prisma: any = {
    tenant: { findUnique: async () => ({ settings: {} }) },
    deliveryTask: {
      findFirst: async () => task,
      findUnique: async () => ({ ...task, order: null }),
      updateMany: async ({ where, data }: any) => {
        if (!match(task, where)) return { count: 0 };
        Object.assign(task, data);
        return { count: 1 };
      },
      count: async ({ where }: any) => (match(task, where) ? 1 : 0),
    },
    courierShift: {
      findFirst: async ({ where }: any) => shifts.find((s) => s.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(shifts.find((s) => s.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = shifts.filter((s) => match(s, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      },
    },
    courier: { findUnique: async ({ where }: any) => shifts.find((s) => s.courierId === where.id)?.courier ?? null },
    courierPayoutLine: { createMany: async ({ data }: any) => payouts.push(...data) },
    courierCashEntry: { createMany: async ({ data }: any) => cash.push(...data) },
    deliveryTaskEvent: { create: async ({ data }: any) => events.push(data) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  const assignment: any = {
    sendToCourier: async (_t: string, chat: string, text: string) => sent.push(`${chat}: ${text}`),
    assignVenue: async () => 0,
  };
  const device = { id: 'd', tenantId: 't', venueId: 'v', name: 'Раздача' } as any;
  return { service: new DispatchBoardService(prisma, assignment, {} as any), task, shifts, payouts, cash, events, sent, device };
}

test('«Забрал курьер…»: заказ в пути у выбранного, курьеру сообщение', async () => {
  const w = world();
  assert.deepEqual(await w.service.markPickedUp(w.device, 'k', 's1'), { status: 'PICKED_UP' });
  assert.equal(w.task.courierId, 'c1');
  assert.equal(w.task.shiftId, 's1');
  assert.equal(w.task.pickupMethod, 'DISPATCH');
  assert.ok(w.task.readyAt && w.task.pickedUpAt);
  assert.equal(w.shifts[0].state, 'ON_DELIVERY');
  assert.equal(w.events[0].type, 'PICKED_UP');
  assert.match(w.sent[0], /^tg1: .*вы везёте №4321/);
  // Начислений при «Забрал» нет — только при «Доставлен»
  assert.equal(w.payouts.length, 0);
});

test('«Забрал» другой курьер: назначенному «отбой», он снова в очереди', async () => {
  const w = world({ status: 'ASSIGNED', courierId: 'c2', shiftId: 's2' });
  await w.service.markPickedUp(w.device, 'k', 's1');
  assert.equal(w.task.courierId, 'c1');
  assert.equal(w.shifts[1].state, 'WAITING');
  assert.ok(w.sent.some((m) => m.startsWith('tg2: ↩️ №4321 забрал другой курьер')));
});

test('«Доставлен» из «Нового»: доставка и наличные — выбранному, очередь не трогаем', async () => {
  const w = world();
  assert.deepEqual(await w.service.markDelivered(w.device, 'k', 's1'), { status: 'DELIVERED' });
  assert.equal(w.task.status, 'DELIVERED');
  assert.equal(w.task.handoffMethod, 'DISPATCH');
  assert.equal(w.task.pickupMethod, 'DISPATCH');
  assert.equal(w.payouts.length, 1);
  assert.equal(w.payouts[0].courierId, 'c1');
  assert.deepEqual(
    w.cash.map((c) => [c.courierId, c.type, c.amount]),
    [['c1', 'COLLECTED', 5000]],
  );
  // Курьер стоял в очереди — место за ним
  assert.equal(w.shifts[0].state, 'WAITING');
  assert.match(w.sent[0], /засчитана.*Наличные/);
});

test('«Доставлен» у того, кто везёт: без выбора, курьер возвращается', async () => {
  const w = world({ status: 'PICKED_UP', courierId: 'c2', shiftId: 's2', pickupMethod: 'SCAN', pickedUpAt: new Date() });
  w.shifts[1].state = 'ON_DELIVERY';
  await w.service.markDelivered(w.device, 'k');
  assert.equal(w.task.courierId, 'c2');
  assert.equal(w.task.pickupMethod, 'SCAN');
  assert.equal(w.payouts[0].courierId, 'c2');
  assert.equal(w.shifts[1].state, 'RETURNING');
});

test('ручные статусы: без курьера, самовывоз, закрытый — ошибка', async () => {
  await assert.rejects(world().service.markDelivered(world().device, 'k'), /Выберите курьера/);
  const p = world({ kind: 'PICKUP' });
  await assert.rejects(p.service.markPickedUp(p.device, 'k', 's1'), /самовывоз/);
  const done = world({ status: 'FAILED' });
  await assert.rejects(done.service.markDelivered(done.device, 'k', 's1'), /закрыт/);
  const other = world({ status: 'PICKED_UP', courierId: 'c2', shiftId: 's2' });
  await assert.rejects(other.service.markPickedUp(other.device, 'k', 's1'), /другой курьер/);
});

test('отчёт: отметки раздачи считаются, но не портят сроки', () => {
  const at = (m: number) => new Date(2026, 10, 25, 12, m);
  const base = { kind: 'DELIVERY', status: 'DELIVERED', courierId: 'c1', courierName: 'Иван', batchId: null, scheduled: false, orderAt: at(0) };
  const r = buildDeliveryReport({
    from: new Date(2026, 10, 25),
    to: new Date(2026, 10, 26),
    now: at(59),
    tasks: [
      { ...base, id: 'a', number: '1', pickupMethod: 'SCAN', handoffMethod: 'BUTTON', readyAt: at(10), pickedUpAt: at(15), deliveredAt: at(35) },
      // Отметили через полчаса после доставки — время нажатия, не события
      { ...base, id: 'b', number: '2', pickupMethod: 'DISPATCH', handoffMethod: 'DISPATCH', readyAt: at(50), pickedUpAt: at(50), deliveredAt: at(50) },
    ],
    shifts: [],
    events: [],
    payouts: [],
  });
  assert.equal(r.summary.delivered, 2);
  assert.equal(r.summary.dispatchMarked, 1);
  assert.equal(r.summary.onWay.count, 1);
  assert.equal(r.summary.total.median, 35);
  assert.equal(r.byCourier[0].dispatchMarked, 1);
  assert.equal(r.list.find((x) => x.id === 'b')!.dispatchMarked, true);
});
