import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Отмена оператором из ленты заказов.
 *
 * Проверяем не «вызвался ли метод», а то, ради чего он отдельный: что в
 * заказ попадает причина из справочника и метка инициатора, без которых
 * отчёт по отменам показывает число без разбивки.
 */
function serviceFor(
  order: Record<string, unknown> | null,
  options: { resolve?: () => Promise<string> } = {},
) {
  const updates: Record<string, unknown>[] = [];
  const statusCalls: string[] = [];

  const prisma = {
    order: {
      findFirst: async () => order,
      findUniqueOrThrow: async () => ({ ...order, status: 'CANCELLED' }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...order, ...data };
      },
    },
  };
  const cancelReasons = {
    resolve:
      options.resolve ??
      (async () => 'Нет курьеров'),
  };

  const service = new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    cancelReasons as never,
  );
  // setStatus проверяется своими тестами; здесь важна только запись причины
  (service as unknown as Record<string, unknown>).setStatus = async (
    _id: string,
    next: string,
  ) => {
    statusCalls.push(next);
    return { ...order, status: next };
  };

  return { service, updates, statusCalls };
}

test('отмена оператором пишет причину, комментарий и инициатора', async () => {
  const { service, updates, statusCalls } = serviceFor({
    id: 'o1',
    tenantId: 't1',
    status: 'ACCEPTED',
  });

  await service.cancelByOperator('o1', 't1', 'r1', 'клиент не отвечает');

  assert.equal(updates.length, 1);
  assert.equal(updates[0].cancelReasonId, 'r1');
  assert.equal(updates[0].cancelReason, 'клиент не отвечает');
  // ADMIN, а не OPERATOR: значение зафиксировано схемой и отчётом
  assert.equal(updates[0].cancelledBy, 'ADMIN');
  assert.deepEqual(statusCalls, ['CANCELLED']);
});

test('без комментария в заказ попадает название причины', async () => {
  const { service, updates } = serviceFor({
    id: 'o1',
    tenantId: 't1',
    status: 'COOKING',
  });

  await service.cancelByOperator('o1', 't1', 'r1');

  assert.equal(updates[0].cancelReason, 'Нет курьеров');
});

test('оператор отменяет и принятый заказ — окно клиента ему не помеха', async () => {
  const { service, statusCalls } = serviceFor({
    id: 'o1',
    tenantId: 't1',
    status: 'ON_WAY',
    createdAt: new Date('2020-01-01'),
  });

  await service.cancelByOperator('o1', 't1', 'r1');

  assert.deepEqual(statusCalls, ['CANCELLED']);
});

test('повторная отмена не переписывает причину', async () => {
  const { service, updates, statusCalls } = serviceFor({
    id: 'o1',
    tenantId: 't1',
    status: 'CANCELLED',
  });

  await service.cancelByOperator('o1', 't1', 'r2');

  assert.equal(updates.length, 0);
  assert.deepEqual(statusCalls, []);
});

test('неизвестная причина отменяет саму отмену', async () => {
  const { service, updates } = serviceFor(
    { id: 'o1', tenantId: 't1', status: 'NEW' },
    {
      resolve: async () => {
        throw new Error('Неизвестная причина отмены');
      },
    },
  );

  await assert.rejects(
    () => service.cancelByOperator('o1', 't1', 'bad'),
    /Неизвестная причина/,
  );
  assert.equal(updates.length, 0);
});

test('чужой заказ не отменяется', async () => {
  const { service } = serviceFor(null);

  await assert.rejects(
    () => service.cancelByOperator('o1', 't1', 'r1'),
    /Заказ не найден/,
  );
});
