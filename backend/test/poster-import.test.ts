import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addressOf,
  isForeignAggregator,
  phoneKey,
  PosterImportService,
  posterTime,
  splitAddress,
} from '../src/couriers/poster-import.service';
import { externalPaymentLine, orderOf } from '../src/couriers/task-order';

test('адрес из Poster: улица и дом, квартира, координаты', () => {
  assert.deepEqual(splitAddress('улица Казбека Нуралина, 53'), { street: 'улица Казбека Нуралина', house: '53' });
  assert.deepEqual(splitAddress('Ауэзова 47Б'), { street: 'Ауэзова', house: '47Б' });
  assert.deepEqual(splitAddress('мкр. Восточный'), { street: 'мкр. Восточный', house: '' });
  assert.deepEqual(
    addressOf({ client_address: { address1: 'Торайгырова, 12', address2: 'кв. 5', lat: '51.7', lng: '75.3' } }, null),
    { street: 'Торайгырова', house: '12', flat: 'кв. 5', lat: 51.7, lng: 75.3 },
  );
  assert.deepEqual(addressOf({ address: 'Ленина, 3' }, null), { street: 'Ленина', house: '3' });
  assert.deepEqual(addressOf({}, { delivery: { address1: 'Ленина, 4' } }), { street: 'Ленина', house: '4' });
  assert.equal(addressOf({}, null), null);
});

test('время, телефон, Яндекс', () => {
  assert.deepEqual(posterTime('2026-11-24 21:08:13'), new Date(2026, 10, 24, 21, 8, 13));
  assert.equal(posterTime(''), null);
  assert.equal(phoneKey('+7 705 866 33 23'), phoneKey('87058663323'));
  assert.ok(isForeignAggregator({ comment: 'Яндекс Еда №123\nОплата: картой' }));
  assert.ok(!isForeignAggregator({ comment: 'без лука' }));
});

test('оплата заказа из Poster для курьера', () => {
  const base = { label: '1', createdAt: '', phone: null, name: null, address: null, comment: '', items: [], pickup: false, refs: [] };
  assert.equal(externalPaymentLine({ ...base, cash: 8440, card: 0, total: 8440 }).replace(/\s/g, ' '), 'Наличные 8 440 ₸');
  assert.match(externalPaymentLine({ ...base, cash: 0, card: 7360, total: 7530 }).replace(/\s/g, ' '), /Картой 7 360 ₸ — уточните/);
});

// ─── Импорт на памяти ────────────────────────────────────────────────

const NOW = new Date(2026, 10, 25, 13, 0);
const at = (m: number) => {
  const d = new Date(NOW.getTime() - m * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

function world(poster: Record<string, Record<string, unknown>[]>, ours: { acc: string; id: string }[] = []) {
  const tasks: any[] = [];
  const events: any[] = [];
  const prisma: any = {
    tenant: { findUnique: async () => ({ settings: {} }) },
    posterAccount: {
      findMany: async () => [
        { id: 'pb', token: 'tok-pb' },
        { id: 'sun', token: 'tok-sun' },
      ],
    },
    orderDispatch: {
      findMany: async () => ours.map((o) => ({ posterAccountId: o.acc, posterOrderId: o.id, replacedOrders: [] })),
    },
    product: {
      findMany: async ({ where }: any) =>
        where.posterId.in.map((id: string) => ({ posterId: id, name: `${where.posterAccountId}-товар-${id}` })),
    },
    deliveryTask: {
      findMany: async ({ where }: any) =>
        tasks.filter((t) => t.source === 'POSTER' && (!where.status?.in || where.status.in.includes(t.status))),
      create: async ({ data }: any) => {
        if (tasks.some((t) => t.externalKey === data.externalKey)) throw new Error('dup');
        const t = { id: `t${tasks.length + 1}`, status: 'NEW', createdAt: NOW, ...data };
        tasks.push(t);
        return t;
      },
      update: async ({ where, data }: any) => Object.assign(tasks.find((t) => t.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = tasks.filter((t) => t.id === where.id && where.status.in.includes(t.status));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      },
    },
    deliveryTaskEvent: { create: async ({ data }: any) => events.push(data) },
  };
  const client: any = {
    getIncomingOrders: async (token: string) => poster[token] ?? [],
    getTransaction: async (_t: string, id: string) => ({
      payed_cash: id === 'tx1' ? '844000' : '0',
      payed_card: id === 'tx2' ? '300000' : '0',
      payed_sum: id === 'tx1' ? '844000' : '300000',
    }),
  };
  return { service: new PosterImportService(prisma, client), tasks, events };
}

const io = (over: Record<string, unknown>) => ({
  incoming_order_id: '1',
  status: 1,
  service_mode: 3,
  phone: '+77058663323',
  first_name: 'Асель',
  created_at: at(5),
  transaction_id: 'tx1',
  client_address: { address1: 'улица Казбека Нуралина, 53' },
  comment: '',
  products: [{ product_id: '10', count: '1' }],
  ...over,
});

test('заказ старого приложения → плитка; PizzBurg и Sunday склеиваются', async () => {
  const w = world({
    'tok-pb': [io({ incoming_order_id: '501', products: [{ product_id: '10', count: 2 }] })],
    'tok-sun': [io({ incoming_order_id: '77', transaction_id: 'tx2', created_at: at(4), products: [{ product_id: '5', count: 1 }] })],
  });
  const r = await w.service.importTenant('t', 'v', NOW);
  assert.deepEqual(r, { created: 1, merged: 1 });
  assert.equal(w.tasks.length, 1);
  const t = w.tasks[0];
  assert.equal(t.kind, 'DELIVERY');
  assert.equal(t.source, 'POSTER');
  assert.equal(t.cashToCollect, 8440);
  const view = orderOf(t);
  assert.equal(view.number, 'tx1'.slice(-4));
  assert.deepEqual(view.items.map((i) => [i.name, i.qty, i.product?.posterAccountId]), [
    ['pb-товар-10', 2, 'pb'],
    ['sun-товар-5', 1, 'sun'],
  ]);
  assert.equal(t.external.card, 3000);
  assert.equal(t.external.refs.length, 2);

  // Повторный проход ничего не дублирует
  assert.deepEqual(await w.service.importTenant('t', 'v', NOW), { created: 0, merged: 0 });
});

test('не берём: наши, Яндекс, непринятые, старые, без адреса', async () => {
  const w = world(
    {
      'tok-pb': [
        io({ incoming_order_id: '1' }), // наш
        io({ incoming_order_id: '2', comment: 'Яндекс Еда №9' }),
        io({ incoming_order_id: '3', status: 0 }),
        io({ incoming_order_id: '4', created_at: at(200) }),
        io({ incoming_order_id: '5', client_address: null }),
        io({ incoming_order_id: '6', service_mode: 1 }),
        io({ incoming_order_id: '7', service_mode: 2, phone: '+77000000000' }), // самовывоз — берём
      ],
    },
    [{ acc: 'pb', id: '1' }],
  );
  const r = await w.service.importTenant('t', 'v', NOW);
  assert.deepEqual(r, { created: 1, merged: 0 });
  assert.equal(w.tasks[0].kind, 'PICKUP');
  assert.equal(w.tasks[0].cashToCollect, 0);
});

test('кассир отклонил заказ в Poster — плитка снимается', async () => {
  const pb: Record<string, unknown>[] = [io({ incoming_order_id: '501' })];
  const w = world({ 'tok-pb': pb });
  await w.service.importTenant('t', 'v', NOW);
  pb[0] = { ...pb[0], status: 7 };
  await w.service.importTenant('t', 'v', NOW);
  assert.equal(w.tasks[0].status, 'CANCELLED');
});
