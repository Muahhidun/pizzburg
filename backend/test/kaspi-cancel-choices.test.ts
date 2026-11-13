import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';
import {
  UnpaidOrdersService,
  UNPAID_CANCEL_AFTER_MS,
} from '../src/orders/unpaid-orders.service';

/**
 * Решения по деньгам Kaspi при отмене и судьба неоплаченных заказов.
 */
function ordersFor(order: Record<string, unknown>, payments?: Record<string, unknown>) {
  const statusCalls: { next: string; options?: unknown }[] = [];
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    order: {
      findFirst: async () => order,
      findUnique: async () => order,
      findUniqueOrThrow: async () => order,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...order, ...data };
      },
    },
  };
  const service = new OrdersService(
    prisma as never,
    ...(Array(5).fill(undefined) as [never, never, never, never, never]),
    { resolve: async () => 'Нет позиции' } as never,
    ...(Array(5).fill(undefined) as [never, never, never, never, never]),
    payments as never,
  );
  return { service, statusCalls, updates };
}

test('частичный возврат больше суммы заказа отклоняется до отмены', async () => {
  const { service, updates } = ordersFor({
    id: 'o1', tenantId: 't1', status: 'ACCEPTED', total: 5000,
  });
  await assert.rejects(
    service.cancelByOperator('o1', 't1', 'r1', undefined, new Date(), {
      mode: 'PARTIAL',
      amount: 6000,
    }),
    /не больше суммы заказа/,
  );
  assert.equal(updates.length, 0, 'заказ не должен отмениться');
});

test('«без возврата» не создаёт возврат, частичный — на указанную сумму', async () => {
  const calls: { kind: string; amount?: number }[] = [];
  const payments = {
    refundCancelledOrder: async () => calls.push({ kind: 'full' }),
    requestRefund: async (input: { amount?: number }) =>
      calls.push({ kind: 'partial', amount: input.amount }),
  };
  const order = {
    id: 'o1', tenantId: 't1', paymentMethod: 'KASPI_ONLINE',
    paymentStatus: 'PAID', cancelReason: 'Нет позиции',
  };
  const { service } = ordersFor(order, payments);
  const ensure = (service as unknown as {
    ensureKaspiRefund: (id: string, r?: unknown) => Promise<void>;
  }).ensureKaspiRefund.bind(service);

  await ensure('o1', { mode: 'NONE' });
  assert.deepEqual(calls, []);
  await ensure('o1', { mode: 'PARTIAL', amount: 1200 });
  assert.deepEqual(calls, [{ kind: 'partial', amount: 1200 }]);
  await ensure('o1');
  assert.equal(calls.at(-1)?.kind, 'full');
});

test('неоплаченный Kaspi-заказ клиент отменяет и после минуты', async () => {
  const created = new Date('2026-11-13T10:00:00Z');
  const order = {
    id: 'o1', tenantId: 't1', customerId: 'c1', status: 'NEW',
    paymentMethod: 'KASPI_ONLINE', paymentStatus: 'PENDING',
    createdAt: created, cancelUntil: new Date(created.getTime() + 60_000),
    tenant: { settings: {} },
  };
  const { service } = ordersFor(order);
  (service as unknown as Record<string, unknown>).availability = {
    getState: () => ({ cancellation: { customerWindowMinutes: 1 } }),
  };
  let cancelled = false;
  (service as unknown as Record<string, unknown>).setStatus = async () => {
    cancelled = true;
    return order;
  };
  await service.cancelByCustomer(
    'o1', 'c1', undefined, undefined,
    new Date(created.getTime() + 10 * 60_000),
  );
  assert.ok(cancelled);
});

test('напоминание о неоплате уходит один раз, старый заказ снимается системой', async () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const pushes: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const cancelled: string[] = [];
  let reminded = false;
  const prisma = {
    order: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        'unpaidRemindedAt' in where
          ? [{ id: 'fresh', number: 11 }]
          : [{ id: 'stale', number: 7, tenantId: 't1' }],
      updateMany: async () => {
        if (reminded) return { count: 0 };
        reminded = true;
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return data;
      },
    },
  };
  const service = new UnpaidOrdersService(
    prisma as never,
    { setStatus: async (id: string) => cancelled.push(id) } as never,
    { sendOrderEvent: async (id: string) => pushes.push(id) } as never,
  );
  await service.remind(now);
  await service.remind(now);
  assert.deepEqual(pushes, ['fresh']);

  await service.cancelStale(new Date(now.getTime() + UNPAID_CANCEL_AFTER_MS));
  assert.deepEqual(cancelled, ['stale']);
  assert.equal(updates[0].cancelledBy, 'SYSTEM');
});
