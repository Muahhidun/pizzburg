import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService } from '../src/orders/orders.service';
import { wdrinkDryRun, wdrinkPartStatus } from '../src/wdrink/wdrink.client';
import {
  isWdrink,
  wdrinkExternalId,
  wdrinkItems,
  wdrinkShowAt,
} from '../src/wdrink/wdrink-dispatch';
import { drinkKey, planRelink } from '../src/wdrink/wdrink-relink';
import { settlementText } from '../src/wdrink/wdrink-ops.service';

/**
 * Касса WDrink как третий отдел (DECISIONS §15). Сеть и база — заглушки:
 * ни один тест не ходит ни в WDrink, ни в Poster.
 */

test('отдел WDRINK отличается от Poster только видом', () => {
  assert.equal(isWdrink({ kind: 'WDRINK' }), true);
  assert.equal(isWdrink({ kind: 'POSTER' }), false);
  assert.equal(isWdrink({}), false);
  assert.equal(isWdrink(null), false);
});

test('новый состав после нехватки уходит под новым номером части', () => {
  assert.equal(wdrinkExternalId('d1', 0), 'd1:1');
  assert.equal(wdrinkExternalId('d1', 2), 'd1:3');
});

test('предзаказ показывается на кассе за lead минут, обычный — сразу', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  assert.equal(wdrinkShowAt(null, 15, now), null);
  assert.equal(
    wdrinkShowAt(new Date('2026-11-25T13:30:00Z'), 15, now)?.toISOString(),
    '2026-11-25T13:15:00.000Z',
  );
  // До времени меньше lead — показывать сразу
  assert.equal(wdrinkShowAt(new Date('2026-11-25T10:10:00Z'), 15, now), null);
});

test('состав для кассы: позиция, количество и полная цена, без лишнего', () => {
  assert.deepEqual(
    wdrinkItems([
      { qty: 2, price: 1800, product: { posterId: '345' } },
      { qty: 1, price: 0, product: null },
    ]),
    [{ item_id: '345', qty: 2, price: 1800 }],
  );
});

test('отменённый в WDrink заказ закрывает часть, как отклонённый чек', () => {
  assert.equal(wdrinkPartStatus('CANCELLED'), 'REJECTED');
  assert.equal(wdrinkPartStatus('ACCEPTED'), 'ACCEPTED');
  assert.equal(wdrinkPartStatus('SHORTAGE'), 'SHORTAGE');
});

test('дев-режим Poster распространяется на WDrink, если не сказано иное', () => {
  assert.equal(wdrinkDryRun({ POSTER_DRY_RUN: '1' }), true);
  assert.equal(wdrinkDryRun({ POSTER_DRY_RUN: '1', WDRINK_DRY_RUN: '0' }), false);
  assert.equal(wdrinkDryRun({}), false);
});

test('имена напитков сравниваются без регистра, ё и разных запятых', () => {
  assert.equal(drinkKey('Таро 0.7 л (холодный)'), drinkKey('таро 0,7 холодный'));
  assert.equal(drinkKey('Молочный чай Ёжик'), drinkKey('молочный чай ежик'));
});

test('перенос из Sunday: пары по имени, подсказки, неоднозначные и лишние', () => {
  const products = [
    { id: 'p1', name: 'Таро 0,7 холодный', displayName: null, price: 1800 },
    { id: 'p2', name: 'Американо', displayName: 'Американо 0,5 горячий', price: 900 },
    { id: 'p3', name: 'Непонятный', displayName: null, price: 100 },
    { id: 'p4', name: 'Латте', displayName: null, price: 1000 },
    { id: 'p5', name: 'латте', displayName: null, price: 1000 },
  ];
  const items = [
    { id: '10', name: 'Таро 0.7 холодный', price: 1900, category_id: 'c' },
    { id: '11', name: 'Американо 0,5 горячий', price: 900, category_id: 'c' },
    { id: '12', name: 'Латте', price: 1000, category_id: 'c' },
    { id: '13', name: 'Мохито', price: 1200, category_id: 'c' },
  ];
  const plan = planRelink(products, items);
  assert.deepEqual(
    plan.matched.map((m) => [m.product.id, m.item.id, m.priceDiffers]),
    [
      ['p1', '10', true],
      ['p2', '11', false],
    ],
  );
  assert.deepEqual(plan.ambiguous.map((a) => a.products.map((p) => p.id)), [['p4', 'p5']]);
  assert.deepEqual(plan.unmatchedProducts.map((p) => p.id), ['p3']);
  assert.deepEqual(plan.unmatchedItems.map((i) => i.id), ['13']); // '12' — в неоднозначных

  const forced = planRelink(products, items, { p3: '13' });
  assert.ok(forced.matched.some((m) => m.product.id === 'p3' && m.item.id === '13'));
});

test('вечерний расчёт: сумма напитков и как платили клиенты', () => {
  const text = settlementText('25 ноября', 'WeDrink', [
    { number: 1, paymentMethod: 'CASH', lines: [{ qty: 2, price: 1500 }] },
    { number: 2, paymentMethod: 'KASPI_ONLINE', lines: [{ qty: 1, price: 10000 }] },
    { number: 3, paymentMethod: 'CASH', lines: [{ qty: 1, price: 2000 }] },
  ])!;
  assert.match(text, /Отдать WeDrink: <b>15 000 ₸<\/b> наличными/);
  assert.match(text, /наличными у курьеров — 5 000 ₸/);
  assert.match(text, /Kaspi онлайн — 10 000 ₸/);
  assert.match(text, /Заказов с напитками: 3/);
  assert.equal(settlementText('25 ноября', 'WeDrink', []), null);
});

function orderWith(dispatches: any[], extra: Record<string, unknown> = {}) {
  return {
    id: 'o1', number: 1234, type: 'DELIVERY', paymentMethod: 'CASH', paymentStatus: 'PENDING',
    pointsSpent: 0, promoDiscount: 0, deliveryFee: 0, comment: 'позвонить в домофон',
    address: { street: 'Ленина', house: '1' }, scheduledAt: null,
    customerId: null, customer: { phone: '+77000000000' }, tenant: { settings: {} },
    items: [
      {
        name: 'Таро 0,7 холодный', qty: 2, price: 1800, isGift: false, isUnavailable: false,
        modifiers: [], product: { posterId: '345', posterAccountId: 'wd', modifiers: [] },
      },
      {
        name: 'Бургер', qty: 1, price: 2500, isGift: false, isUnavailable: false,
        modifiers: [], product: { posterId: '7', posterAccountId: 'main', modifiers: [] },
      },
    ],
    dispatches,
    ...extra,
  };
}

const wdPart = (extra: Record<string, unknown> = {}) => ({
  id: 'part-wd', posterAccountId: 'wd', status: 'PENDING', posterOrderId: null,
  posterStatus: null, replacedOrders: [],
  posterAccount: {
    name: 'WeDrink', kind: 'WDRINK', token: 'wdp_stub', apiUrl: 'http://stub', preorderLeadMin: 15,
  },
  ...extra,
});

async function dispatchWith(order: any, wdrink: any, resend?: string[]) {
  const updates: any[] = [];
  let posterSent: any = null;
  const prisma = {
    order: { findUniqueOrThrow: async () => order },
    orderDispatch: { update: async (input: any) => updates.push(input) },
  };
  const poster = {
    createIncomingOrder: async (_t: string, payload: any) => {
      posterSent = payload;
      return { incoming_order_id: 55 };
    },
  };
  const telegram = { notifyCashier: async () => ({}) };
  const service = new OrdersService(
    prisma as never,
    poster as never,
    ...(Array(7).fill(undefined) as never[]),
    telegram as never,
    undefined as never,
    undefined as never,
    undefined as never,
    wdrink as never,
  );
  const previous = { p: process.env.POSTER_DRY_RUN, w: process.env.WDRINK_DRY_RUN };
  process.env.POSTER_DRY_RUN = '0';
  delete process.env.WDRINK_DRY_RUN;
  try {
    await service.dispatchToPoster('o1', resend ? { resend } : undefined);
  } finally {
    if (previous.p === undefined) delete process.env.POSTER_DRY_RUN;
    else process.env.POSTER_DRY_RUN = previous.p;
    if (previous.w !== undefined) process.env.WDRINK_DRY_RUN = previous.w;
  }
  return { updates, posterSent };
}

test('общий заказ: еда — в Poster, напитки — на кассу WDrink, без телефона и адреса', async () => {
  const created: any[] = [];
  const wdrink = { createOrder: async (_a: any, body: any) => { created.push(body); return { status: 'NEW' }; } };
  const order = orderWith([
    { id: 'part-main', posterAccountId: 'main', status: 'PENDING', posterAccount: { token: 't', name: 'Основной', kind: 'POSTER' } },
    wdPart(),
  ]);
  const { updates, posterSent } = await dispatchWith(order, wdrink);
  assert.deepEqual(posterSent.products.map((p: any) => p.product_id), [7]);
  assert.deepEqual(created, [
    { external_id: 'part-wd:1', number: 1234, items: [{ item_id: '345', qty: 2, price: 1800 }] },
  ]);
  const wdUpdate = updates.find((u) => u.where.id === 'part-wd');
  assert.equal(wdUpdate.data.status, 'SENT');
  assert.equal(wdUpdate.data.posterOrderId, 'part-wd:1');
});

test('новый состав снимает прежний заказ WDrink и уходит под следующим номером', async () => {
  const calls: string[] = [];
  const wdrink = {
    cancelOrder: async (_a: any, id: string, reason: string) => { calls.push(`cancel ${id} ${reason}`); return {}; },
    createOrder: async (_a: any, body: any) => { calls.push(`create ${body.external_id}`); return {}; },
  };
  const order = orderWith([wdPart({ status: 'SENT', posterOrderId: 'part-wd:1', posterStatus: 'SHORTAGE' })]);
  const { updates } = await dispatchWith(order, wdrink, ['part-wd']);
  assert.deepEqual(calls, ['cancel part-wd:1 REPLACED', 'create part-wd:2']);
  assert.equal(updates[0].data.replacedOrders.length, 1);
});

test('принятый на кассе WDrink заказ новым составом не перекрывается', async () => {
  const wdrink = { createOrder: async () => assert.fail('не должно уйти'), cancelOrder: async () => assert.fail('нет') };
  const order = orderWith([wdPart({ status: 'SENT', posterOrderId: 'part-wd:1', posterStatus: 'ACCEPTED' })]);
  const { updates } = await dispatchWith(order, wdrink, ['part-wd']);
  assert.match(updates[0].data.error, /уже принял/);
});

test('ошибка WDrink помечает часть FAILED, а не теряет заказ', async () => {
  const wdrink = { createOrder: async () => { throw new Error('PRICE_MISMATCH'); } };
  const { updates } = await dispatchWith(orderWith([wdPart()]), wdrink);
  assert.equal(updates[0].data.status, 'FAILED');
  assert.match(updates[0].data.error, /PRICE_MISMATCH/);
});

test('предзаказ: касса WDrink увидит его за 15 минут до времени', async () => {
  const created: any[] = [];
  const wdrink = { createOrder: async (_a: any, body: any) => { created.push(body); return {}; } };
  const at = new Date(Date.now() + 2 * 60 * 60_000);
  await dispatchWith(orderWith([wdPart()], { scheduledAt: at }), wdrink);
  assert.equal(created[0].show_at, new Date(at.getTime() - 15 * 60_000).toISOString());
});
