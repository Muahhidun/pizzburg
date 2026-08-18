import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Любая отмена гасит ожидание ответа по нехватке (DECISIONS §12.9).
 *
 * Отменить заказ могут четверо: клиент, оператор, отказ основного отдела
 * и автозакрытие. Гасим в общем `setStatus`, а не в каждом из них, —
 * пятый способ отмены забудут связать с нехваткой.
 */
function serviceFor(status: string) {
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    order: {
      findFirst: async () => ({ id: 'o1', tenantId: 't1', status }),
      update: async () => ({ id: 'o1' }),
      updateMany: async (args: Record<string, unknown>) => {
        updates.push(args);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ id: 'o1' }),
    },
  };
  const loyalty = { onStatusChanged: async () => 0 };
  const notifications = { sendOrderStatus: async () => undefined };

  const service = new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    loyalty as never,
    notifications as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return { service, updates };
}

test('отмена снимает ожидание ответа', async () => {
  const { service, updates } = serviceFor('NEW');

  await service.setStatus('o1', 'CANCELLED' as never);

  assert.equal(updates.length, 1);
  // Только висящее ожидание: уже проставленный CANCELLED_BY_CUSTOMER —
  // это причина отмены, и затирать её нельзя
  assert.equal(
    (updates[0].where as Record<string, unknown>).shortageState,
    'AWAITING_CUSTOMER',
  );
  assert.deepEqual(updates[0].data, {
    shortageState: 'NONE',
    shortageDeadline: null,
  });
});

test('обычная смена статуса ожидание не трогает', async () => {
  const { service, updates } = serviceFor('NEW');

  await service.setStatus('o1', 'ACCEPTED' as never);

  assert.deepEqual(updates, []);
});
