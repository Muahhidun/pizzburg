import assert from 'node:assert/strict';
import test from 'node:test';
import { CancelReasonsService } from '../src/orders/cancel-reasons.service';

function serviceWithOrders(orders: unknown[]) {
  const prisma = { order: { findMany: async () => orders } };
  return new CancelReasonsService(prisma as never);
}

function serviceWithReason(reason: unknown) {
  const prisma = { cancelReason: { findFirst: async () => reason } };
  return new CancelReasonsService(prisma as never);
}

test('отчёт группирует отмены по причине и считает потери', async () => {
  const service = serviceWithOrders([
    { total: 6300, cancelledBy: 'CUSTOMER', cancelReason: null, cancelReasonRef: { id: 'r1', label: 'Клиент передумал' } },
    { total: 4000, cancelledBy: 'ADMIN', cancelReason: null, cancelReasonRef: { id: 'r2', label: 'Нет позиции в наличии' } },
    { total: 2500, cancelledBy: 'ADMIN', cancelReason: null, cancelReasonRef: { id: 'r2', label: 'Нет позиции в наличии' } },
  ]);

  const report = await service.report('t1', new Date('2026-08-01'), new Date('2026-09-01'));

  assert.equal(report.total, 3);
  assert.equal(report.lostAmount, 12800);
  // самая частая причина идёт первой
  assert.equal(report.byReason[0].label, 'Нет позиции в наличии');
  assert.equal(report.byReason[0].count, 2);
  assert.equal(report.byReason[0].amount, 6500);
  assert.deepEqual(report.byWho, { CUSTOMER: 1, ADMIN: 2 });
});

test('отмены без справочной причины не теряются в отчёте', async () => {
  const service = serviceWithOrders([
    { total: 1000, cancelledBy: 'ADMIN', cancelReason: 'звонил, не берёт', cancelReasonRef: null },
    { total: 2000, cancelledBy: null, cancelReason: null, cancelReasonRef: null },
  ]);

  const report = await service.report('t1', new Date('2026-08-01'), new Date('2026-09-01'));

  assert.equal(report.total, 2);
  const labels = report.byReason.map((r) => r.label).sort();
  assert.deepEqual(labels, ['Без причины', 'звонил, не берёт']);
  assert.equal(report.byWho.UNKNOWN, 1);
});

test('клиенту нельзя выбрать служебную причину', async () => {
  const service = serviceWithReason({
    id: 'r1',
    label: 'Нет курьеров',
    availableToCustomer: false,
    isActive: true,
  });

  await assert.rejects(
    () => service.resolve('t1', 'r1', true),
    /недоступна клиенту/,
  );
  // оператору та же причина доступна
  assert.equal(await service.resolve('t1', 'r1', false), 'Нет курьеров');
});

test('чужая или выключенная причина отклоняется', async () => {
  const service = serviceWithReason(null);
  await assert.rejects(
    () => service.resolve('t1', 'unknown', false),
    /Неизвестная причина/,
  );
});
