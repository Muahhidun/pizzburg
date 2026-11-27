import assert from 'node:assert/strict';
import test from 'node:test';
import { completeDelivery } from '../src/couriers/delivery-completion';

/**
 * Сдача из кассы (27.11.2026, заказ №351): заказ 6 920 ₸, клиент просил
 * сдачу с 10 000. Кассир кладёт курьеру 3 080, клиент отдаёт 10 000 —
 * курьер должен кассе 10 000, а не 6 920.
 */

function txWith(changeFrom: number | null) {
  const cash: Record<string, unknown>[] = [];
  const tx = {
    deliveryTask: { updateMany: async () => ({ count: 1 }) },
    courierPayoutLine: { createMany: async () => ({ count: 1 }) },
    courierCashEntry: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        cash.push(...data);
        return { count: data.length };
      },
    },
    order: { findUnique: async () => ({ changeFrom }) },
  };
  return { tx, cash };
}

const deliver = (tx: unknown, task: { cashToCollect: number; orderId?: string | null }) =>
  completeDelivery(tx as never, {
    tenantId: 't',
    task: { id: 'task-1', kind: 'DELIVERY', ...task },
    courierId: 'c1',
    shiftId: 's1',
    from: ['PICKED_UP'],
    currentCourierId: 'c1',
    deliveryPay: 800,
    now: new Date(),
    handoffMethod: 'BUTTON',
  });

const owed = (cash: Record<string, unknown>[]) => cash.reduce((s, e) => s + (e.amount as number), 0);

test('сдача с 10 000 при заказе 6 920 — курьер должен 10 000', async () => {
  const { tx, cash } = txWith(10_000);
  assert.equal(await deliver(tx, { cashToCollect: 6920, orderId: 'o1' }), true);
  assert.deepEqual(cash.map((e) => [e.type, e.amount]), [['COLLECTED', 6920], ['CHANGE_FLOAT', 3080]]);
  assert.equal(owed(cash), 10_000);
});

test('без сдачи — только сумма заказа', async () => {
  const { tx, cash } = txWith(null);
  await deliver(tx, { cashToCollect: 6920, orderId: 'o1' });
  assert.deepEqual(cash.map((e) => e.type), ['COLLECTED']);
  assert.equal(owed(cash), 6920);
});

test('«сдача с» без сдачи (ровно сумма или меньше) — сдачи нет', async () => {
  const { tx, cash } = txWith(6920);
  await deliver(tx, { cashToCollect: 6920, orderId: 'o1' });
  assert.equal(owed(cash), 6920);
});

test('заказ из Poster (без нашего заказа) — только наличные из чека', async () => {
  const { tx, cash } = txWith(10_000);
  await deliver(tx, { cashToCollect: 6920, orderId: null });
  assert.equal(owed(cash), 6920);
});

test('оплачен онлайн — ни наличных, ни сдачи', async () => {
  const { tx, cash } = txWith(10_000);
  await deliver(tx, { cashToCollect: 0, orderId: 'o1' });
  assert.deepEqual(cash, []);
});
