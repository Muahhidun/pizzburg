import assert from 'node:assert/strict';
import test from 'node:test';
import { CashierPanelService } from '../src/cashier-panel/cashier-panel.service';
import {
  categoryMenu,
  durationMenu,
  orderingMenu,
  panelKeyboard,
  panelText,
  rushMenu,
  searchProducts,
  stopQuery,
  stopsMenu,
} from '../src/cashier-panel/panel-view';

const TZ = 'Asia/Almaty';
const ID = 'cmabcdefghijklmnopqrstuvw';

const menu = [
  { id: '1', name: 'Пицца Болоньезе 30 см' },
  { id: '2', name: 'Курица с грибами 30 см' },
  { id: '3', name: 'Пепперони 30 см' },
  { id: '4', name: 'Кола 1 л' },
  { id: '5', name: 'Кола 0,5 л' },
  { id: '6', name: 'Бургер с курицей' },
];
const names = (q: string) => searchProducts(q, menu).map((x) => x.name);

test('поиск понимает начало слова, опечатки и любой порядок слов', () => {
  assert.deepEqual(names('пепп'), ['Пепперони 30 см']);
  assert.equal(names('баланьезе')[0], 'Пицца Болоньезе 30 см');
  assert.equal(names('болон')[0], 'Пицца Болоньезе 30 см');
  assert.equal(names('грибы курица')[0], 'Курица с грибами 30 см');
  assert.deepEqual(names('кола 1'), ['Кола 1 л']);
  assert.deepEqual(names('ёлка'), []);
});

test('«стоп …» распознаётся в разных написаниях, прочий текст — нет', () => {
  assert.equal(stopQuery('стоп пепперони'), 'пепперони');
  assert.equal(stopQuery('Стоп: кола 1 л'), 'кола 1 л');
  assert.equal(stopQuery('стоплист'), null);
  assert.equal(stopQuery('нужно поставить стоп'), null);
});

test('пульт показывает приём, спрос и стоп-лист', () => {
  const text = panelText(
    {
      mode: 'PICKUP_ONLY',
      orderingUntil: '2026-11-23T10:30:00Z',
      rushExtraMinutes: 20,
      rushUntil: '2026-11-23T11:00:00Z',
      stops: [{ name: 'Пепперони <30>', until: new Date('2026-11-23T17:00:00Z') }],
    },
    TZ,
  );
  assert.match(text, /Доставка остановлена<\/b> до 15:30/);
  assert.match(text, /\+20 мин<\/b> до 16:00/);
  assert.match(text, /Пепперони &lt;30&gt; — до 22:00/);
  assert.match(panelText({ mode: 'ALL', orderingUntil: null, rushExtraMinutes: 0, rushUntil: null, stops: [] }, TZ), /Стоп-лист: пусто/);
});

test('у стопа нет «бессрочно»: только 1 час, 2 часа, до конца дня', () => {
  const labels = durationMenu('p', ID, 'Пепперони', 'p:s').keyboard[0].map((b) => b.text);
  assert.deepEqual(labels, ['На 1 час', 'На 2 часа', 'До конца дня']);
});

test('данные всех кнопок пульта в пределах 64 байт', () => {
  const s = { mode: 'CLOSED' as const, orderingUntil: null, rushExtraMinutes: 20, rushUntil: null, stops: [] };
  const products = Array.from({ length: 40 }, (_, i) => ({ id: ID, name: `Товар ${i}`, stopped: i === 0 }));
  const all = [
    ...panelKeyboard(),
    ...orderingMenu(s, TZ).keyboard,
    ...rushMenu(s, TZ).keyboard,
    ...stopsMenu([{ id: ID, name: 'X', until: new Date(), kind: 'category' }], [{ id: ID, name: 'Пиццы' }], TZ).keyboard,
    ...categoryMenu({ id: ID, name: 'Пиццы' }, products, 1).keyboard,
    ...durationMenu('k', ID, 'Пиццы', `p:sc:${ID}:0`).keyboard,
  ].flat();
  for (const b of all) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

test('категория листается страницами по 16', () => {
  const products = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Товар ${i}`, stopped: false }));
  const first = categoryMenu({ id: 'c', name: 'Пиццы' }, products, 0);
  assert.equal(first.keyboard.slice(0, 8).flat().length, 16);
  assert.match(first.text, /\(1\/2\)/);
  const nav = first.keyboard.find((r) => r.some((b) => b.text === 'Ещё ▸'))!;
  assert.equal(nav[0].callback_data, 'p:sc:c:1');
});

// ─── Сервис ────────────────────────────────────────────────────

function setup(settings: Record<string, any> = {}) {
  const calls: Array<{ method: string; payload: any }> = [];
  const done: Record<string, unknown[][]> = { ordering: [], rush: [], stop: [], release: [] };
  const tenantSettings = { telegram: { cashierChatId: '-100' }, ...settings };
  const prisma = {
    tenant: {
      findUnique: async () => ({ settings: tenantSettings }),
      findMany: async () => [],
      update: async (a: any) => Object.assign(tenantSettings, a.data.settings),
    },
    product: {
      findMany: async () => [
        { id: 'p1', name: 'Pepperoni', displayName: 'Пепперони 30 см', appCategoryId: 'c1', stoppedUntil: null, sortOverride: null, sortOrder: 1 },
      ],
      findFirst: async () => ({ name: 'Pepperoni', displayName: 'Пепперони 30 см' }),
    },
    appCategory: { findMany: async () => [{ id: 'c1', name: 'Пиццы' }], findFirst: async () => ({ id: 'c1', name: 'Пиццы' }) },
  };
  const telegram = {
    call: async (_t: string, method: string, payload: any) => {
      calls.push({ method, payload });
      return { error: null, result: { message_id: 500 + calls.length } };
    },
  };
  const availability = {
    getState: () => ({ mode: 'ALL', orderingUntil: null, rushExtraMinutes: 0, rushUntil: null }),
  };
  const svc = new CashierPanelService(
    prisma as any,
    telegram as any,
    { register: () => {} } as any,
    availability as any,
    { setTemporary: async (...a: unknown[]) => done.ordering.push(a) } as any,
    { set: async (...a: unknown[]) => done.rush.push(a) } as any,
    {
      active: async () => ({ products: [], categories: [] }),
      stop: async (...a: unknown[]) => {
        done.stop.push(a);
        return { name: 'Пепперони 30 см', until: new Date('2026-11-23T10:00:00Z') };
      },
      release: async (...a: unknown[]) => done.release.push(a),
    } as any,
  );
  const msg = (text: string, chat = -100) =>
    svc.handle('t', { message: { message_id: 7, chat: { id: chat }, text, from: { id: 1, first_name: 'Айгерим' } } });
  const press = (data: string, messageId = 900) =>
    svc.handle('t', {
      callback_query: { id: 'q', from: { id: 1, first_name: 'Айгерим' }, data, message: { message_id: messageId, chat: { id: -100 } } },
    });
  return { svc, calls, done, msg, press, tenantSettings };
}

test('/pult присылает пульт, закрепляет и запоминает его', async () => {
  const { calls, msg, tenantSettings } = setup();
  assert.equal(await msg('/pult@pizzburg_bot'), true);
  const sent = calls.find((c) => c.method === 'sendMessage')!;
  assert.match(sent.payload.text, /Пульт кассы/);
  assert.ok(calls.some((c) => c.method === 'pinChatMessage'));
  assert.ok(calls.some((c) => c.method === 'deleteMessage' && c.payload.message_id === 7), 'команду убираем из ленты');
  assert.equal(typeof tenantSettings.cashierPanel.messageId, 'number');
});

test('обычные сообщения и чужие чаты пульт не трогает', async () => {
  const { calls, msg } = setup();
  assert.equal(await msg('Кассир, привет'), false);
  assert.equal(await msg('/pult', -555), false);
  assert.equal(calls.length, 0);
});

test('кнопка у поля ввода «Приём заказов» открывает меню', async () => {
  const { calls, msg } = setup();
  await msg('🛑 Приём заказов');
  const menuMsg = calls.find((c) => c.method === 'sendMessage')!;
  assert.match(menuMsg.payload.text, /Доставку/);
  assert.equal(menuMsg.payload.reply_markup.inline_keyboard[0][0].callback_data, 'p:op:30');
});

test('«стоп пепп» — кандидаты кнопками, дальше выбор срока и стоп', async () => {
  const { calls, done, msg, press } = setup();
  await msg('стоп пепп');
  const found = calls.find((c) => c.method === 'sendMessage')!;
  assert.equal(found.payload.reply_markup.inline_keyboard[0][0].callback_data, 'p:sp:p1');

  await press('p:py:p1:T');
  assert.equal(done.stop[0][2], 'TWO_HOURS');
  assert.deepEqual(done.stop[0][1], { productId: 'p1' });
  assert.equal(done.stop[0][5], 'Айгерим');
  const log = calls.filter((c) => c.method === 'editMessageText').at(0)!;
  assert.match(log.payload.text, /«Пепперони 30 см»<\/b> на стопе до 15:00\n👤 Айгерим/);
});

test('остановить доставку на час — запись в журнале с именем', async () => {
  const { calls, done, press } = setup();
  await press('p:op:60');
  assert.deepEqual(done.ordering[0].slice(1, 3), ['PICKUP_ONLY', 60]);
  assert.equal(done.ordering[0][4], 'Айгерим');
  assert.match(calls.find((c) => c.method === 'editMessageText')!.payload.text, /Доставка остановлена до/);
});

test('кнопка на самом пульте открывает меню новым сообщением, а не правит закреп', async () => {
  const { calls, press } = setup({ cashierPanel: { chatId: '-100', messageId: 900 } });
  await press('p:r', 900);
  assert.ok(calls.some((c) => c.method === 'sendMessage' && /Высокий спрос/.test(c.payload.text)));
  assert.ok(!calls.some((c) => c.method === 'editMessageText' && c.payload.message_id === 900 && /Высокий спрос/.test(c.payload.text)));
});
