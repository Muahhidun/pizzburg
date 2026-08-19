import assert from 'node:assert/strict';
import test from 'node:test';
import { ShortageService } from '../src/orders/shortage.service';

/**
 * Кнопка «Позиции нашлись» (DECISIONS §12.9).
 *
 * Пока ждём ответа — это отмена промаха кассира по чекбоксу. После
 * ответа сумма уже пересчитана, лишние баллы возвращены и исправленный
 * чек ушёл в кассу: вернуть строку значило бы показать полный состав по
 * уменьшенной цене и ничего не сообщить кухне.
 */
function serviceFor(shortageState: string) {
  const cleared: unknown[] = [];
  const prisma = {
    order: {
      findFirst: async () => ({
        id: 'o1',
        status: 'NEW',
        shortageState,
        items: [],
        dispatches: [],
      }),
      findUniqueOrThrow: async () => ({ shortageState }),
      update: async () => ({}),
    },
    orderItem: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (ops: unknown[]) => {
      cleared.push(ops);
      return [];
    },
  };

  const service = new ShortageService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  (service as unknown as Record<string, unknown>).state = async () => ({});
  return { service, cleared };
}

test('во время ожидания пометку снять можно', async () => {
  const { service, cleared } = serviceFor('AWAITING_CUSTOMER');

  await service.markUnavailable('t1', 'o1', []);

  assert.equal(cleared.length, 1);
});

test('после ответа клиента пометку уже не снять', async () => {
  const { service, cleared } = serviceFor('KEPT_REST');

  await assert.rejects(
    () => service.markUnavailable('t1', 'o1', []),
    /сумма пересчитана/,
  );
  assert.deepEqual(cleared, []);
});

test('после отмены клиентом — тоже', async () => {
  const { service } = serviceFor('CANCELLED_BY_CUSTOMER');

  await assert.rejects(
    () => service.markUnavailable('t1', 'o1', []),
    /новым заказом/,
  );
});

test('когда нехватки не было, пустой список ничего не ломает', async () => {
  const { service, cleared } = serviceFor('NONE');

  await service.markUnavailable('t1', 'o1', []);

  assert.deepEqual(cleared, []);
});
