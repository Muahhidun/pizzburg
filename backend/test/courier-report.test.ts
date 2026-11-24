import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeliveryReport } from '../src/couriers/courier-report.service';

const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m);

const task = (over: Partial<Parameters<typeof buildDeliveryReport>[0]['tasks'][0]>) => ({
  id: Math.random().toString(36),
  kind: 'DELIVERY',
  status: 'DELIVERED',
  courierId: 'c1',
  courierName: 'Асхат Б.',
  batchId: null,
  pickupMethod: 'SCAN',
  number: '1',
  orderAt: at(12),
  scheduled: false,
  readyAt: at(12, 20),
  pickedUpAt: at(12, 25),
  deliveredAt: at(12, 40),
  ...over,
});

test('этапы, доля до 60 минут, часы и курьеры', () => {
  const r = buildDeliveryReport({
    from: at(0),
    to: new Date(2026, 10, 25),
    now: at(23),
    tasks: [
      task({}), // 20 кухня, 5 ждал, 15 в пути, 40 всего
      task({ orderAt: at(13), readyAt: at(13, 30), pickedUpAt: at(13, 50), deliveredAt: at(14, 20), courierId: 'c2', courierName: 'Ерлан К.', pickupMethod: 'MANUAL' }), // 80 всего
      task({ status: 'FAILED', deliveredAt: null }),
      task({ scheduled: true, orderAt: at(9), readyAt: at(12, 50), pickedUpAt: at(12, 55), deliveredAt: at(13, 10) }), // предзаказ
    ],
    shifts: [
      { courierId: 'c1', courierName: 'Асхат Б.', startedAt: at(11), endedAt: at(15), endedBy: 'COURIER' },
      { courierId: 'c2', courierName: 'Ерлан К.', startedAt: at(12, 30), endedAt: null, endedBy: null },
    ],
    events: [{ type: 'PICKUP_TIMEOUT', courierId: 'c2' }],
    payouts: [{ courierId: 'c1', amount: 800 }, { courierId: 'c1', amount: 800 }],
  });
  const s = r.summary;
  assert.equal(s.delivered, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.manualPickups, 1);
  assert.equal(s.pickupTimeouts, 1);
  assert.equal(s.shiftsOpen, 1);
  // Предзаказ не входит во «всего»: 40 и 80
  assert.equal(s.total.count, 2);
  assert.equal(s.total.avg, 60);
  assert.equal(s.within60, 50);
  assert.equal(s.kitchen.count, 2);

  const h12 = r.byHour.find((h) => h.hour === 12)!;
  assert.equal(h12.orders, 2); // предзаказ оформлен в 9:00
  // В 12:00–13:00: Асхат весь час, Ерлан полчаса
  assert.equal(h12.couriersOnShift, 1.5);

  const c1 = r.byCourier.find((c) => c.courierId === 'c1')!;
  assert.equal(c1.delivered, 2);
  assert.equal(c1.earned, 1600);
  assert.equal(c1.hours, 4);
  const c2 = r.byCourier.find((c) => c.courierId === 'c2')!;
  assert.equal(c2.shiftsNotClosed, 1);
  assert.equal(c2.pickupTimeouts, 1);

  assert.equal(r.byDay.length, 1);
  assert.equal(r.byDay[0].delivered, 3);
  assert.equal(r.list.length, 4);
});
