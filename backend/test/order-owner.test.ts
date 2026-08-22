import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderOwnerGuard } from '../src/auth/order-owner.guard';

/**
 * Заказ принадлежит тому, кто его открывает (DECISIONS §12.26).
 *
 * До этой проверки статус заказа отдавался любому, кто знает
 * идентификатор, — а в ответе лежат адрес доставки и телефон.
 */
function guardWith(order: unknown) {
  const asked: Record<string, unknown>[] = [];
  const prisma = {
    order: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        asked.push(args.where);
        return order;
      },
    },
  };
  return { guard: new OrderOwnerGuard(prisma as never), asked };
}

function ctx(params: Record<string, string>, customer?: { sub: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, customer }) }),
  } as never;
}

test('свой заказ проходит, и спрашиваем именно пару заказ+клиент', async () => {
  const { guard, asked } = guardWith({ id: 'o1' });
  assert.equal(await guard.canActivate(ctx({ orderId: 'o1' }, { sub: 'c1' })), true);
  assert.deepEqual(asked[0], { id: 'o1', customerId: 'c1' });
});

test('чужой заказ выглядит как несуществующий', async () => {
  const { guard } = guardWith(null);
  // Именно «не найден», а не «нельзя»: разница в ответах сама по себе
  // утечка — по ней перебором видно, какие заказы существуют
  await assert.rejects(
    () => guard.canActivate(ctx({ orderId: 'чужой' }, { sub: 'c1' })),
    /не найден/,
  );
});

test('без клиента в запросе не пропускаем', async () => {
  const { guard } = guardWith({ id: 'o1' });
  await assert.rejects(() => guard.canActivate(ctx({ orderId: 'o1' })));
});

test('без идентификатора заказа не пропускаем', async () => {
  const { guard } = guardWith({ id: 'o1' });
  await assert.rejects(
    () => guard.canActivate(ctx({}, { sub: 'c1' })),
    /не найден/,
  );
});
