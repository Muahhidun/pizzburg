import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Повторное оформление заказа.
 *
 * Два разных случая, которые нельзя путать: сорвавшийся запрос (один
 * заказ, отправленный дважды) и осознанный второй заказ. Первый обязан
 * вернуть уже созданный заказ, второй — создать новый.
 */
function serviceFor(recent: Record<string, unknown>[]) {
  const prisma = {
    order: {
      findMany: async () => recent,
    },
  };
  const service = new OrdersService(
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
  return service as unknown as {
    findRecentDuplicate: (
      customerId: string,
      dto: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | null>;
  };
}

const existing = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  number: 7,
  type: 'DELIVERY',
  paymentMethod: 'CASH',
  address: { street: 'Ауэзова', house: '47б', flat: '12' },
  items: [
    { productId: 'p1', qty: 2, isGift: false },
    { productId: 'p2', qty: 1, isGift: false },
  ],
  ...over,
});

const dto = (over: Record<string, unknown> = {}) => ({
  type: 'DELIVERY',
  paymentMethod: 'CASH',
  address: { street: 'Ауэзова', house: '47б', flat: '12' },
  items: [
    { productId: 'p1', qty: 2 },
    { productId: 'p2', qty: 1 },
  ],
  ...over,
});

test('тот же заказ, отправленный дважды, узнаётся', async () => {
  const service = serviceFor([existing()]);
  const found = await service.findRecentDuplicate('c1', dto());
  assert.equal(found?.number, 7);
});

test('порядок позиций в корзине ничего не меняет', async () => {
  const service = serviceFor([existing()]);
  const found = await service.findRecentDuplicate(
    'c1',
    dto({ items: [{ productId: 'p2', qty: 1 }, { productId: 'p1', qty: 2 }] }),
  );
  assert.equal(found?.number, 7);
});

test('другое количество — другой заказ', async () => {
  const service = serviceFor([existing()]);
  const found = await service.findRecentDuplicate(
    'c1',
    dto({ items: [{ productId: 'p1', qty: 3 }, { productId: 'p2', qty: 1 }] }),
  );
  assert.equal(found, null);
});

test('тот же состав на другой адрес — разные заказы', async () => {
  // Себе и родителям: подменять второй заказ первым нельзя
  const service = serviceFor([existing()]);
  const found = await service.findRecentDuplicate(
    'c1',
    dto({ address: { street: 'Ауэзова', house: '47б', flat: '90' } }),
  );
  assert.equal(found, null);
});

test('другой способ оплаты — другой заказ', async () => {
  const service = serviceFor([existing()]);
  const found = await service.findRecentDuplicate(
    'c1',
    dto({ paymentMethod: 'CARD_ON_DELIVERY' }),
  );
  assert.equal(found, null);
});

test('подарок по акции не мешает узнать повтор', async () => {
  // Подарок появился при первом оформлении, в корзине клиента его нет
  const service = serviceFor([
    existing({
      items: [
        { productId: 'p1', qty: 2, isGift: false },
        { productId: 'p2', qty: 1, isGift: false },
        { productId: 'gift', qty: 1, isGift: true },
      ],
    }),
  ]);
  const found = await service.findRecentDuplicate('c1', dto());
  assert.equal(found?.number, 7);
});

test('когда недавних заказов нет, повтора нет', async () => {
  const service = serviceFor([]);
  assert.equal(await service.findRecentDuplicate('c1', dto()), null);
});
