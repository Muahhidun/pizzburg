import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Повтор прошлого заказа.
 *
 * Главное здесь — что переносится, а что нет. Корзина пересобирается по
 * ТЕКУЩЕМУ меню: цены могли измениться, позиции — закончиться. Подарки
 * не переносятся: их заново выдаёт промо-движок, если условие снова
 * выполнено.
 */
function serviceFor(
  order: Record<string, unknown> | null,
  products: Record<string, unknown>[] = [],
) {
  const prisma = {
    order: { findFirst: async () => order },
    product: { findMany: async () => products },
  };
  return new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

const available = (id: string) => ({
  id,
  isVisible: true,
  isActive: true,
  category: { isActive: true },
  posterAccount: { isActive: true },
});

test('позиции переносятся с количеством и модификаторами', async () => {
  const service = serviceFor(
    {
      id: 'o1',
      items: [
        {
          productId: 'p1',
          name: 'Маргарита',
          qty: 2,
          modifiers: [{ posterId: 'm1', name: 'Бортик', price: 700 }],
        },
      ],
    },
    [available('p1')],
  );

  const r = await service.repeatOrder('o1', 't1', 'c1');

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].productId, 'p1');
  assert.equal(r.items[0].qty, 2);
  assert.deepEqual(r.items[0].modifiers, [
    { posterId: 'm1', name: 'Бортик', price: 700 },
  ]);
  assert.equal(r.unavailable.length, 0);
});

test('позиция из стоп-листа не молча пропадает, а объясняется', async () => {
  const service = serviceFor(
    {
      id: 'o1',
      items: [
        { productId: 'p1', name: 'Маргарита', qty: 1, modifiers: [] },
        { productId: 'p2', name: 'Пепперони', qty: 1, modifiers: [] },
      ],
    },
    [
      available('p1'),
      { ...available('p2'), isActive: false },
    ],
  );

  const r = await service.repeatOrder('o1', 't1', 'c1');

  assert.equal(r.items.length, 1);
  assert.deepEqual(r.unavailable, [
    { name: 'Пепперони', reason: 'сегодня закончилось' },
  ]);
});

test('снятый с витрины товар отличается от закончившегося', async () => {
  const service = serviceFor(
    {
      id: 'o1',
      items: [{ productId: 'p1', name: 'Старая пицца', qty: 1, modifiers: [] }],
    },
    [{ ...available('p1'), isVisible: false }],
  );

  const r = await service.repeatOrder('o1', 't1', 'c1');

  assert.equal(r.items.length, 0);
  assert.equal(r.unavailable[0].reason, 'больше нет в меню');
});

test('удалённый из базы товар не роняет повтор', async () => {
  const service = serviceFor(
    {
      id: 'o1',
      items: [{ productId: 'gone', name: 'Снята с продажи', qty: 1, modifiers: [] }],
    },
    [],
  );

  const r = await service.repeatOrder('o1', 't1', 'c1');

  assert.equal(r.items.length, 0);
  assert.equal(r.unavailable.length, 1);
});

test('неработающий отдел объясняется отдельно', async () => {
  const service = serviceFor(
    {
      id: 'o1',
      items: [{ productId: 'p1', name: 'Ролл', qty: 1, modifiers: [] }],
    },
    [{ ...available('p1'), posterAccount: { isActive: false } }],
  );

  const r = await service.repeatOrder('o1', 't1', 'c1');

  assert.equal(r.unavailable[0].reason, 'отдел не работает');
});

test('чужой заказ повторить нельзя', async () => {
  const service = serviceFor(null);

  await assert.rejects(
    () => service.repeatOrder('o1', 't1', 'c1'),
    /Заказ не найден/,
  );
});
