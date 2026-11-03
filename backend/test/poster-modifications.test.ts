import assert from 'node:assert/strict';
import test from 'node:test';
import { posterModifications } from '../src/orders/poster-modifications';
import { OrdersService } from '../src/orders/orders.service';

const group = (id: number, qty: number, option: number) => ({
  dish_modification_group_id: id,
  num_min: qty, num_max: qty, is_deleted: 0,
  modifications: [{ dish_modification_id: option }],
});
const groups = [group(23, 1, 52), group(25, 2, 54), group(26, 1, 55)];
const oldClient = [{ posterId: '52' }, { posterId: '54' }, { posterId: '55' }];

test('старый клиент без qty отправляет одну пиццу, два фри и одну колу', () => {
  assert.deepEqual(posterModifications(groups, oldClient), [
    { m: 52, a: 1 }, { m: 54, a: 2 }, { m: 55, a: 1 },
  ]);
  assert.deepEqual(oldClient[1], { posterId: '54' });
});

test('явное количество фиксированного компонента не переопределяет техкарту', () => {
  for (const qty of [1, 2, 99]) {
    assert.deepEqual(posterModifications(groups, [{ posterId: '54', qty }]), [{ m: 54, a: 2 }]);
  }
});

test('повторный выбор того же фиксированного компонента не удваивает норму', () => {
  assert.deepEqual(posterModifications(groups, [{ posterId: '54' }, { posterId: '54' }]), [{ m: 54, a: 2 }]);
});

test('не добавляет компонент, которого клиент вообще не выбирал', () => {
  assert.deepEqual(posterModifications(groups, [{ posterId: '52' }]), [{ m: 52, a: 1 }]);
});

test('обычные и наши непостерные добавки сохраняют прежнее поведение', () => {
  assert.deepEqual(posterModifications(null, [{ posterId: '7', qty: 3 }, { posterId: '8' }, {}]), [
    { m: 7, a: 3 }, { m: 8, a: 1 },
  ]);
});

test('строковые числа в техкарте поддерживаются', () => {
  assert.deepEqual(posterModifications([{ ...group(25, 2, 54), num_min: '2', num_max: '2', is_deleted: '0' }], [{ posterId: '54' }]), [{ m: 54, a: 2 }]);
});

test('удалённые и необязательные группы не задают количество', () => {
  for (const g of [
    { ...group(25, 2, 54), is_deleted: 1 },
    { ...group(25, 2, 54), num_min: 0 },
    { ...group(25, 2, 54), num_max: 3 },
  ]) assert.deepEqual(posterModifications([g], [{ posterId: '54' }]), [{ m: 54, a: 1 }]);
});

test('группа с несколькими вариантами не позволяет угадать распределение двух порций', () => {
  const g = { ...group(25, 2, 54), modifications: [{ dish_modification_id: 54 }, { dish_modification_id: 60 }] };
  assert.deepEqual(posterModifications([g], [{ posterId: '54' }]), [{ m: 54, a: 1 }]);
});

test('повреждённые или противоречивые фиксированные группы не угадываются', () => {
  for (const raw of [
    {}, [null], [{ ...group(25, 2, 54), num_min: 2.5, num_max: 2.5 }],
    [group(25, 2, 54), group(30, 3, 54)], [group(25, 100, 54)],
  ]) assert.deepEqual(posterModifications(raw, [{ posterId: '54' }]), [{ m: 54, a: 1 }]);
});

test('dispatch формирует правильный запрос Poster для двух комбо без сети и реальных заказов', async () => {
  let sent: any;
  const updates: any[] = [];
  const order = {
    id: 'test-order', number: 100, type: 'PICKUP', paymentMethod: 'CARD_ON_DELIVERY',
    pointsSpent: 0, promoDiscount: 0, deliveryFee: 0, comment: null, address: null,
    scheduledAt: null, customer: { phone: '+77000000000' }, tenant: { settings: {} },
    items: [{
      name: 'Комбо Маргарита', qty: 2, price: 3990, isGift: false, isUnavailable: false,
      modifiers: oldClient.map(m => ({ ...m, price: 0 })),
      product: { posterId: '164', posterAccountId: 'main', modifiers: groups },
    }],
    dispatches: [{ id: 'part', posterAccountId: 'main', status: 'PENDING', posterAccount: { token: 'stub-token', name: 'main' } }],
  };
  const prisma = { order: { findUniqueOrThrow: async () => order }, orderDispatch: { update: async (input: any) => updates.push(input) } };
  const poster = { createIncomingOrder: async (_token: string, payload: any) => { sent = payload; return { incoming_order_id: 123 }; } };
  const service = new OrdersService(prisma as never, poster as never, ...Array(7).fill(undefined) as [never, never, never, never, never, never, never]);
  const previousDryRun = process.env.POSTER_DRY_RUN;
  // This client is a local stub with no fetch or external endpoint.
  process.env.POSTER_DRY_RUN = '0';
  try {
    await service.dispatchToPoster('test-order');
  } finally {
    if (previousDryRun === undefined) delete process.env.POSTER_DRY_RUN;
    else process.env.POSTER_DRY_RUN = previousDryRun;
  }
  assert(sent, 'Poster stub must receive a payload');
  assert.equal(sent.products[0].count, 2);
  assert.deepEqual(JSON.parse(sent.products[0].modification), [
    { m: 52, a: 1 }, { m: 54, a: 2 }, { m: 55, a: 1 },
  ]);
  assert.equal(updates[0].data.status, 'SENT');
});
