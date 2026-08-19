import assert from 'node:assert/strict';
import test from 'node:test';
import { ShortageService } from '../src/orders/shortage.service';

/**
 * Отмена заказа во время ожидания ответа (DECISIONS §12.9).
 *
 * Ожидание живёт отдельным полем и переживало отмену: фоновая задача
 * находила заказ по одному `shortageState`, «решала за клиента» и слала
 * на планшет чек по отменённому заказу. Проверяем оба рубежа — выборку
 * просроченных и сам пересчёт.
 */
function serviceFor(order: Record<string, unknown>) {
  const queries: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const dispatched: unknown[] = [];

  const prisma = {
    order: {
      findMany: async (args: Record<string, unknown>) => {
        queries.push(args.where as Record<string, unknown>);
        return [];
      },
      findUniqueOrThrow: async () => order,
      updateMany: async (args: Record<string, unknown>) => {
        updates.push(args as Record<string, unknown>);
        return { count: 1 };
      },
    },
  };
  const orders = {
    dispatchToPoster: async (...args: unknown[]) => {
      dispatched.push(args);
    },
  };

  const service = new ShortageService(
    prisma as never,
    undefined as never,
    orders as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  (service as unknown as Record<string, unknown>).state = async () => ({});

  return { service, queries, updates, dispatched };
}

test('крон не берёт отменённые и доставленные заказы', async () => {
  const { service, queries } = serviceFor({});

  await service.resolveExpired(new Date());

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].status, { notIn: ['CANCELLED', 'DELIVERED'] });
});

test('пересчёт отменённого заказа не идёт и чек в кассу не уходит', async () => {
  const { service, updates, dispatched } = serviceFor({
    id: 'o1',
    number: 42,
    status: 'CANCELLED',
    items: [],
    dispatches: [],
  });

  await (service as unknown as {
    keepRest: (id: string, by: string) => Promise<unknown>;
  }).keepRest('o1', 'TIMEOUT');

  // Ни одной отправки в Poster
  assert.deepEqual(dispatched, []);
  // Ожидание снято, чтобы крон не возвращался к заказу каждую минуту
  assert.equal(updates.length, 1);
  assert.equal(
    (updates[0].where as Record<string, unknown>).shortageState,
    'AWAITING_CUSTOMER',
  );
  assert.deepEqual(updates[0].data, {
    shortageState: 'NONE',
    shortageDeadline: null,
  });
});
