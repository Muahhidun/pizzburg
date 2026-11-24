import assert from 'node:assert/strict';
import test from 'node:test';
import { bestPartner, detourKm, distanceKm, streetHouseOf } from '../src/couriers/batching';
import { nextInBatch } from '../src/couriers/courier-app.service';
import { departmentOf, otherDepartments } from '../src/couriers/dispatch-board.service';

// Раздача и точки вокруг: ~0,009° широты ≈ 1 км
const V = { lat: 51.72, lng: 75.32 };
const north1 = { lat: 51.729, lng: 75.32 }; // 1 км на север
const north2 = { lat: 51.738, lng: 75.321 }; // 2 км на север
const south1 = { lat: 51.711, lng: 75.32 }; // 1 км на юг
const east1 = { lat: 51.72, lng: 75.3345 }; // 1 км на восток

test('расстояние по прямой', () => {
  assert.ok(Math.abs(distanceKm(V, north1) - 1) < 0.02);
  assert.equal(distanceKm(V, V), 0);
});

test('в одну сторону — крюк почти нулевой, в разные — большой', () => {
  assert.ok(detourKm(V, north1, north2) < 0.2);
  // Север и юг: круг 4 км против 2 км поездки к дальнему
  assert.ok(Math.abs(detourKm(V, north1, south1) - 2) < 0.05);
  // Север и восток (под прямым углом) — тоже не по пути
  assert.ok(detourKm(V, north1, east1) > 0.5);
});

test('крюк не зависит от того, какой заказ первый', () => {
  assert.ok(Math.abs(detourKm(V, north1, north2) - detourKm(V, north2, north1)) < 1e-9);
});

test('напарник: ближайший по крюку, только в пределах лимита и с координатами', () => {
  const cands = [
    { id: 'south', point: south1 },
    { id: 'none', point: null },
    { id: 'far-north', point: north2 },
    { id: 'east', point: east1 },
  ];
  assert.equal(bestPartner(V, north1, cands, 1.5)?.item.id, 'far-north');
  assert.equal(bestPartner(V, north1, [cands[0], cands[1]], 1.5), null);
  // С лимитом 0 связок нет вовсе, кроме совпадающих точек
  assert.equal(bestPartner(V, north1, [cands[3]], 0), null);
});

test('улица и дом из адреса точки', () => {
  assert.deepEqual(streetHouseOf('Экибастуз, Ауэзова 47Б, ТРЦ'), { street: 'Ауэзова', house: '47Б' });
  assert.deepEqual(streetHouseOf('Ауэзова 47б'), { street: 'Ауэзова', house: '47б' });
  assert.deepEqual(streetHouseOf('Экибастуз, улица Мáшхур Жусупа 12/1'), {
    street: 'улица Мáшхур Жусупа',
    house: '12/1',
  });
  assert.equal(streetHouseOf('Экибастуз'), null);
});

test('адрес второго заказа связки скрыт, пока первый в пути', () => {
  const a = { id: 'a', status: 'PICKED_UP', batchId: 'b1', batchSeq: 1 };
  const b = { id: 'b', status: 'PICKED_UP', batchId: 'b1', batchSeq: 2 };
  const solo = { id: 's', status: 'PICKED_UP', batchId: null, batchSeq: null };
  assert.equal(nextInBatch(b, [a, b]), a);
  assert.equal(nextInBatch(a, [a, b]), null);
  assert.equal(nextInBatch(solo, [solo]), null);
  // Первый доставлен — в списке активных его уже нет
  assert.equal(nextInBatch(b, [b]), null);
});

const depts = { mainId: 'pb', names: new Map([['pb', 'Основной'], ['sun', 'Sunday']]) };
const item = (dept: string | null, qty = 1, isUnavailable = false) => ({
  qty,
  isUnavailable,
  product: dept ? { posterAccountId: dept } : null,
});

test('отдел позиции: основной и без товара не помечаются', () => {
  assert.equal(departmentOf(item('sun'), depts), 'Sunday');
  assert.equal(departmentOf(item('pb'), depts), null);
  assert.equal(departmentOf(item(null), depts), null);
  // Один отдел у тенанта — меток нет
  assert.equal(departmentOf(item('sun'), { mainId: 'sun', names: new Map([['sun', 'Sunday']]) }), null);
});

test('плитка: сколько позиций Sunday и весь ли заказ из Sunday', () => {
  assert.deepEqual(otherDepartments([item('pb'), item('sun', 2), item('sun')], depts), [
    { name: 'Sunday', count: 3, only: false },
  ]);
  assert.deepEqual(otherDepartments([item('sun'), item('pb', 1, true)], depts), [
    { name: 'Sunday', count: 1, only: true },
  ]);
  assert.deepEqual(otherDepartments([item('pb')], depts), []);
});

// ─── Назначение со связками на памяти ───────────────────────────────

import { AssignmentService } from '../src/couriers/assignment.service';

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'courier') return true; // статус курьера в фикстуре всегда ACTIVE
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('lt' in v) return row[k] != null && row[k] < v.lt;
      return true;
    }
    return row[k] === v;
  });
}

function world(points: Record<string, { lat: number; lng: number }>, waiting = 1) {
  const tasks: any[] = [];
  const shifts: any[] = [];
  const events: any[] = [];
  const sent: string[] = [];
  for (let i = 0; i < waiting; i++) {
    shifts.push({ id: `s${i}`, venueId: 'v', courierId: `c${i}`, state: 'WAITING', endedAt: null, queuedAt: i, scheduled: false });
  }
  const sortBy = (rows: any[], key: string) => [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  const prisma: any = {
    venue: {
      findUnique: async () => ({ address: 'Экибастуз, Ауэзова 47Б', lat: V.lat, lng: V.lng, tenant: { slug: 'x', settings: {} } }),
    },
    deliveryTask: {
      findFirst: async ({ where }: any) => sortBy(tasks.filter((t) => matches(t, where)), 'readyAt')[0] ?? null,
      findMany: async ({ where }: any) =>
        sortBy(tasks.filter((t) => matches(t, where)), 'readyAt').map((t) => ({ ...t, order: t.order })),
      findUnique: async () => null, // уведомления в тесте не нужны
      updateMany: async ({ where, data }: any) => {
        const rows = tasks.filter((t) => matches(t, where));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      },
    },
    courierShift: {
      findFirst: async ({ where }: any) => sortBy(shifts.filter((s) => matches(s, where)), 'queuedAt')[0] ?? null,
      findMany: async ({ where }: any) =>
        shifts
          .filter((s) => matches(s, where))
          .map((s) => ({ ...s, tasks: tasks.filter((t) => t.shiftId === s.id && ['ASSIGNED', 'PICKED_UP'].includes(t.status)) })),
      updateMany: async ({ where, data }: any) => {
        const rows = shifts.filter((s) => matches(s, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      },
    },
    deliveryTaskEvent: { create: async ({ data }: any) => events.push(data) },
    tenant: { findUnique: async () => ({ slug: 'x' }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const geo: any = { coordsOf: async () => null };
  const telegram: any = { call: async (_t: string, _m: string, p: any) => (sent.push(p.text), {}) };
  const service = new AssignmentService(prisma, telegram, geo);
  const ready = (id: string, minute: number) =>
    tasks.push({
      id, tenantId: 't', venueId: 'v', kind: 'DELIVERY', status: 'READY', courierId: null, shiftId: null,
      batchId: null, batchSeq: null, readyAt: new Date(T(minute)),
      order: { createdAt: new Date(T(minute - 20)), address: { street: 's', house: '1', ...points[id] } },
    });
  return { service, tasks, shifts, events, ready };
}
const T = (m: number) => 1_800_000_000_000 + m * 60_000;

test('один курьер, два готовых заказа в одну сторону → связка, старый первым', async () => {
  const w = world({ a: north2, b: north1 });
  w.ready('a', 0);
  w.ready('b', 1);
  assert.equal(await w.service.assignVenue('v'), 2);
  const [a, b] = w.tasks;
  assert.equal(a.courierId, 'c0');
  assert.equal(b.courierId, 'c0');
  assert.equal(a.batchId, 'a');
  assert.equal(b.batchId, 'a');
  assert.equal(a.batchSeq, 1); // старше — первым, хоть и дальше
  assert.equal(b.batchSeq, 2);
});

test('заказы в разные стороны не связываются — второй ждёт свободного курьера', async () => {
  const w = world({ a: north1, b: south1 });
  w.ready('a', 0);
  w.ready('b', 1);
  assert.equal(await w.service.assignVenue('v'), 1);
  assert.equal(w.tasks[1].status, 'READY');
  assert.equal(w.tasks[0].batchId, null);
});

test('при двух свободных курьерах связки нет: каждому по заказу', async () => {
  const w = world({ a: north2, b: north1 }, 2);
  w.ready('a', 0);
  w.ready('b', 1);
  assert.equal(await w.service.assignVenue('v'), 2);
  assert.equal(w.tasks[0].courierId, 'c0');
  assert.equal(w.tasks[1].courierId, 'c1');
  assert.equal(w.tasks[0].batchId, null);
});

test('третий заказ в связку не попадает: не больше двух', async () => {
  const w = world({ a: north2, b: north1, c: north1 });
  w.ready('a', 0);
  w.ready('b', 1);
  w.ready('c', 2);
  assert.equal(await w.service.assignVenue('v'), 2);
  assert.equal(w.tasks[2].status, 'READY');
});

test('«Уехал»: назначенная связка возвращается в «Готов», курьер вне очереди', async () => {
  const w = world({ a: north2, b: north1 });
  w.ready('a', 0);
  w.ready('b', 1);
  await w.service.assignVenue('v');
  const prisma: any = (w.service as any).prisma;
  prisma.courierShift.findUnique = async () => ({
    ...w.shifts[0],
    tenantId: 't',
    courier: { telegramUserId: '1' },
    tasks: w.tasks.filter((t) => t.status === 'ASSIGNED').map((t) => ({ ...t, order: { number: t.id === 'a' ? 101 : 102 } })),
  });
  prisma.deliveryTask.count = async () => 0;
  const released = await w.service.releaseShift('s0', 'COURIER_LEFT', 'DEVICE:d');
  assert.deepEqual(released, [101, 102]);
  assert.equal(w.shifts[0].state, 'AWAY');
  for (const t of w.tasks) {
    assert.equal(t.status, 'READY');
    assert.equal(t.courierId, null);
    assert.equal(t.batchId, null);
  }
  assert.ok(w.events.some((e) => e.type === 'COURIER_LEFT'));
});
