import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EVENT_RETENTION_DAYS,
  EventsService,
  MAX_EVENTS_PER_BATCH,
} from '../src/events/events.service';

/**
 * Поведенческие события (DECISIONS §12.24).
 *
 * Поле открыто наружу и пишется с чужих телефонов, поэтому проверяем
 * именно то, что защищает таблицу от мусора.
 */
function service() {
  const saved: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const prisma = {
    appEvent: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        saved.push(...data);
        return { count: data.length };
      },
      deleteMany: async (args: unknown) => {
        deleted.push(args);
        return { count: 3 };
      },
    },
  };
  return { service: new EventsService(prisma as never), saved, deleted };
}

test('неизвестный тип отбрасывается, а не роняет запрос', async () => {
  const { service: s, saved } = service();
  const result = await s.record(
    't1',
    [
      { type: 'search', payload: { query: 'пицца' } },
      { type: 'menu_search_v2' },
      { type: 'product_view', payload: { productId: 'p1' } },
    ],
    { deviceId: 'dev-1' },
  );

  // Старая сборка не должна получать ошибку из-за переименованного события
  assert.equal(result.recorded, 2);
  assert.deepEqual(saved.map((r) => r.type), ['search', 'product_view']);
});

test('пачка обрезается по пределу', async () => {
  const { service: s, saved } = service();
  const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 20 }, () => ({
    type: 'app_open',
  }));
  const result = await s.record('t1', many, {});
  assert.equal(result.recorded, MAX_EVENTS_PER_BATCH);
  assert.equal(saved.length, MAX_EVENTS_PER_BATCH);
});

test('длинные строки и вложенность в нагрузку не проходят', async () => {
  const { service: s, saved } = service();
  await s.record(
    't1',
    [
      {
        type: 'search',
        payload: {
          query: 'я'.repeat(500),
          results: 0,
          nested: { чужое: 'дерево' },
          ids: Array.from({ length: 50 }, (_, i) => `p${i}`),
        },
      },
    ],
    {},
  );

  const payload = saved[0].payload as Record<string, unknown>;
  assert.equal((payload.query as string).length, 200);
  assert.equal(payload.results, 0);
  // Произвольные деревья выбрасываем целиком
  assert.equal('nested' in payload, false);
  assert.equal((payload.ids as string[]).length, 20);
});

test('пустая пачка не ходит в базу', async () => {
  const { service: s, saved } = service();
  const result = await s.record('t1', [{ type: 'выдумка' }], {});
  assert.equal(result.recorded, 0);
  assert.equal(saved.length, 0);
});

test('гость пишется без клиента, но с устройством', async () => {
  const { service: s, saved } = service();
  await s.record('t1', [{ type: 'app_open' }], { deviceId: 'dev-9' });
  assert.equal(saved[0].customerId, null);
  assert.equal(saved[0].deviceId, 'dev-9');
});

test('чистка удаляет только то, что старше срока хранения', async () => {
  const { service: s, deleted } = service();
  const now = new Date('2026-08-21T00:00:00Z');
  await s.prune(now);

  const where = (deleted[0] as { where: { at: { lt: Date } } }).where;
  const expected = new Date(
    now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000,
  );
  assert.equal(where.at.lt.getTime(), expected.getTime());
});
