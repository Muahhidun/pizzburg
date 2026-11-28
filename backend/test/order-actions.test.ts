import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderActionsService } from '../src/orders/order-actions.service';
import {
  actionsButton,
  menuKeyboard,
  parseMask,
  pickedIds,
  shortageKeyboard,
} from '../src/orders/order-keyboards';

/**
 * Кнопки под заказом в группе кассиров: «⋯ Действия» разворачивает меню
 * в том же сообщении, отмена — через причину и подтверждение, «нет
 * позиции» — выбор позиций галочками.
 */
const ID = 'cmabcdefghijklmnopqrstuvw'; // cuid, 25 знаков

test('данные всех кнопок укладываются в 64 байта Телеграма', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, name: `Позиция ${i}`, qty: 1 }));
  const all = [
    ...actionsButton(ID, true),
    ...menuKeyboard(ID),
    ...shortageKeyboard(ID, items, 2 ** 40 - 1),
  ].flat();
  for (const b of all) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

test('галочка переключает позицию, «Спросить клиента» — только когда что-то отмечено', () => {
  const items = [
    { id: 'a', name: 'Пепперони', qty: 2 },
    { id: 'b', name: 'Кола 1 л', qty: 1 },
  ];
  const empty = shortageKeyboard(ID, items, 0);
  assert.equal(empty[0][0].text, '⬜️ 2× Пепперони');
  assert.equal(empty.at(-1)!.length, 1); // только «Назад»

  const next = parseMask(empty[1][0].callback_data.split(':')[3]);
  assert.deepEqual(pickedIds(items, next), ['b']);
  const picked = shortageKeyboard(ID, items, next);
  assert.equal(picked[1][0].text, '☑️ Кола 1 л');
  assert.match(picked.at(-1)![1].callback_data, /^o:sy:/);
  // Повторное нажатие снимает галочку
  assert.equal(parseMask(picked[1][0].callback_data.split(':')[3]), 0);
});

function setup(order: Record<string, unknown>) {
  const calls: Array<{ method: string; payload: any }> = [];
  const cancels: unknown[][] = [];
  const marks: unknown[][] = [];
  const prisma = {
    order: { findFirst: async () => order },
    orderDispatch: { findMany: async () => (order as any).afterResend ?? [] },
  };
  const telegram = {
    call: async (_t: string, method: string, payload: any) => {
      calls.push({ method, payload });
      return { error: null };
    },
  };
  const accepted: unknown[][] = [];
  const resent: unknown[] = [];
  const orders = {
    cancelByOperator: async (...a: unknown[]) => cancels.push(a),
    setStatus: async (...a: unknown[]) => accepted.push(a),
    dispatchToPoster: async (id: unknown) => resent.push(id),
  };
  const shortage = { markUnavailable: async (...a: unknown[]) => marks.push(a) };
  const reasons = {
    list: async () => [{ id: 'r1', label: 'Нет курьеров' }],
    resolve: async () => 'Нет курьеров',
  };
  const svc = new OrderActionsService(
    prisma as any, telegram as any, orders as any, shortage as any, reasons as any,
  );
  const press = (data: string, chat = -100) =>
    svc.handle('t', { id: 'q', from: { id: 1 }, data, message: { message_id: 9, chat: { id: chat } } }, 'Айгерим');
  return { calls, cancels, marks, accepted, resent, press };
}

const baseOrder = {
  id: ID,
  number: 157,
  status: 'NEW',
  type: 'PICKUP',
  address: null,
  scheduledAt: null,
  comment: '',
  total: 5660,
  deliveryFee: 0,
  pointsSpent: 0,
  promoDiscount: 0,
  paymentMethod: 'KASPI_ONLINE',
  paymentStatus: 'PAID',
  changeFrom: null,
  cashierChatId: '-100',
  customer: { phone: '+77010000000' },
  tenant: { settings: {} },
  items: [
    { id: 'a', name: 'Пепперони', qty: 1, price: 3000, isGift: false, isUnavailable: false, modifiers: [] },
    { id: 'b', name: 'Кола 1 л', qty: 1, price: 800, isGift: false, isUnavailable: false, modifiers: [] },
  ],
};

test('отмена: причина → подтверждение с возвратом → заказ отменён, в карточке кто отменил', async () => {
  const { calls, cancels, press } = setup(baseOrder);
  await press(`o:c:${ID}`);
  assert.equal(calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data, `o:cr:${ID}:r1`);

  await press(`o:cr:${ID}:r1`);
  const confirm = calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!;
  assert.equal(confirm.payload.reply_markup.inline_keyboard[1][0].text, '❌ Да, отменить и вернуть деньги');
  assert.equal(cancels.length, 0, 'до подтверждения ничего не отменяем');

  await press(`o:cy:${ID}:r1`);
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0][6], 'Айгерим');
  const edit = calls.find((c) => c.method === 'editMessageText')!;
  assert.match(edit.payload.text, /^🚫 <b>ОТМЕНЁН<\/b> — Айгерим, \d\d:\d\d\. Причина: Нет курьеров/);
  assert.match(edit.payload.text, /Заказ №157/);
  assert.deepEqual(edit.payload.reply_markup.inline_keyboard, []);
});

test('нет позиции: отмеченные позиции уходят в разбор нехватки с именем кассира', async () => {
  const { marks, calls, press } = setup(baseOrder);
  await press(`o:sy:${ID}:2`); // маска 2 = вторая позиция
  assert.deepEqual(marks[0].slice(1, 3), [ID, ['b']]);
  assert.equal(marks[0][4], 'Айгерим');
  const last = calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!;
  assert.equal(last.payload.reply_markup.inline_keyboard[0][0].text, '⋯ Действия');
});

test('отменённый заказ: кнопки убираем и говорим, что уже отменён', async () => {
  const { calls, cancels, press } = setup({ ...baseOrder, status: 'CANCELLED' });
  await press(`o:cy:${ID}:r1`);
  assert.equal(cancels.length, 0);
  assert.deepEqual(calls[0].payload.reply_markup.inline_keyboard, []);
  assert.match(calls[1].payload.text, /уже отменён/);
});

test('кнопка из чужого чата ничего не делает', async () => {
  const { cancels, calls, press } = setup(baseOrder);
  await press(`o:cy:${ID}:r1`, -555);
  assert.equal(cancels.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.show_alert, true);
});

test('ошибку сервиса показываем кассиру окном', async () => {
  const calls: Array<{ method: string; payload: any }> = [];
  const svc = new OrderActionsService(
    { order: { findFirst: async () => baseOrder } } as any,
    { call: async (_t: string, method: string, payload: any) => { calls.push({ method, payload }); return { error: null }; } } as any,
    {} as any,
    {
      markUnavailable: async () => {
        throw Object.assign(new Error('x'), { response: { message: '«Кухня» уже приняла заказ на планшете' } });
      },
    } as any,
    {} as any,
  );
  await svc.handle('t', { id: 'q', from: { id: 1 }, data: `o:sy:${ID}:1`, message: { message_id: 9, chat: { id: -100 } } }, 'Айгерим');
  const toast = calls.at(-1)!;
  assert.equal(toast.method, 'answerCallbackQuery');
  assert.equal(toast.payload.show_alert, true);
  assert.match(toast.payload.text, /уже приняла/);
});

const sent = { ...baseOrder, dispatches: [{ status: 'SENT', posterOrderId: '501' }] };

test('принят в Телеграме: подтверждение → статус ACCEPTED, в карточке кто принял, «Действия» остаются', async () => {
  const { calls, accepted, press } = setup(sent);
  assert.equal(menuKeyboard(ID)[0][0].text, '✅ Принять заказ');
  await press(`o:a:${ID}`);
  assert.equal(accepted.length, 0, 'до подтверждения не принимаем');
  const confirm = calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!;
  assert.equal(confirm.payload.reply_markup.inline_keyboard[0][0].callback_data, `o:ay:${ID}`);
  // №357: «✅ Да, заказ принят» читалось как итог — теперь кнопка зовёт нажать
  assert.equal(confirm.payload.reply_markup.inline_keyboard[0][0].text, '👉 Нажмите, чтобы принять заказ');
  assert.match(calls.at(-1)!.payload.text, /ещё НЕ принят/);

  await press(`o:ay:${ID}`);
  assert.deepEqual(accepted[0].slice(0, 3), [ID, 'ACCEPTED', 't']);
  const edit = calls.find((c) => c.method === 'editMessageText')!;
  assert.match(edit.payload.text, /^✅ <b>ПРИНЯТ<\/b> в Телеграме — Айгерим, \d\d:\d\d/);
  assert.match(edit.payload.text, /Заказ №157/);
  assert.deepEqual(
    edit.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text),
    ['✅ Принят', '⋯ Действия'],
  );
});

test('принятый заказ: метка «Принят» над «Действиями», в меню нет кнопки принять', async () => {
  const { calls, press } = setup({ ...sent, status: 'ACCEPTED' });
  await press(`o:m:${ID}`);
  const menu = calls[0].payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
  assert.ok(!menu.includes('✅ Принять заказ'));
  assert.ok(menu.includes('❌ Отменить'));
  await press(`o:x:${ID}`);
  assert.deepEqual(
    calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text),
    ['✅ Принят', '⋯ Действия'],
  );
  await press(`o:i:${ID}`);
  assert.equal(calls.at(-1)!.payload.text, 'Заказ №157 принят');
  // Новый заказ — метки нет
  assert.deepEqual(actionsButton(ID).map((r) => r[0].text), ['⋯ Действия']);
});

test('принять нельзя: уже принят, ещё не на планшете, ждём клиента по нехватке', async () => {
  for (const [order, re] of [
    [{ ...sent, status: 'ACCEPTED' }, /уже принят/],
    [{ ...sent, dispatches: [] }, /ещё не ушёл на планшет/],
    [{ ...sent, shortageState: 'AWAITING_CUSTOMER' }, /ждём ответ клиента/],
  ] as const) {
    const { calls, accepted, press } = setup(order);
    await press(`o:ay:${ID}`);
    assert.equal(accepted.length, 0);
    assert.match(calls.at(-1)!.payload.text, re);
    assert.equal(calls.at(-1)!.payload.show_alert, true);
  }
});

import { OrdersService } from '../src/orders/orders.service';

test('принят на планшете: в сообщении о заказе появляется метка «Принят»', async () => {
  const calls: Array<{ method: string; payload: any }> = [];
  const prisma = {
    order: {
      findFirst: async () => ({ id: ID, number: 157, tenantId: 't', status: 'NEW', cashierChatId: '-100', cashierMessageId: 9 }),
      update: async () => ({ id: ID }),
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => ({ id: ID }),
    },
  };
  const telegram = { call: async (_t: string, method: string, payload: any) => (calls.push({ method, payload }), { error: null }) };
  const svc = new OrdersService(
    prisma as never, undefined as never, undefined as never,
    { onStatusChanged: async () => 0 } as never,
    { sendOrderStatus: async () => undefined } as never,
    undefined as never, undefined as never, undefined as never, undefined as never,
    telegram as never,
  );
  await svc.setStatus(ID, 'ACCEPTED' as never);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'editMessageReplyMarkup');
  assert.equal(calls[0].payload.message_id, 9);
  assert.deepEqual(calls[0].payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text), ['✅ Принят', '⋯ Действия']);
});

// ─── №357: чек не дошёл до Poster, автозакрытие оплаченного ──────────

const failed = { ...baseOrder, dispatches: [{ status: 'SENT', posterOrderId: 'w1' }, { status: 'FAILED', posterOrderId: null }] };

test('чек упал, кассир пробила вручную — «Принять» работает, даже если ни одна часть не ушла', async () => {
  const { accepted, press } = setup({ ...baseOrder, dispatches: [{ status: 'FAILED', posterOrderId: null }] });
  await press(`o:ay:${ID}`);
  assert.deepEqual(accepted[0].slice(0, 2), [ID, 'ACCEPTED']);
});

test('«Пробили вручную» — заказ принят одним нажатием, повторно не отправляем', async () => {
  const { accepted, resent, calls, press } = setup(failed);
  await press(`o:mn:${ID}`);
  assert.deepEqual(accepted[0].slice(0, 2), [ID, 'ACCEPTED']);
  assert.equal(resent.length, 0);
  assert.deepEqual(
    calls.find((c) => c.method === 'editMessageReplyMarkup')!.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text),
    ['✅ Принят', '⋯ Действия'],
  );
});

test('«Отправить ещё раз»: ушло — кнопки сворачиваются; снова упало — говорим пробить вручную', async () => {
  const ok = setup({ ...failed, afterResend: [{ status: 'SENT' }, { status: 'SENT' }] });
  await ok.press(`o:rs:${ID}`);
  assert.deepEqual(ok.resent, [ID]);
  assert.match(ok.calls.at(-1)!.payload.text, /ушёл в Poster/);

  const bad = setup({ ...failed, afterResend: [{ status: 'SENT' }, { status: 'FAILED' }] });
  await bad.press(`o:rs:${ID}`);
  assert.match(bad.calls.at(-1)!.payload.text, /пробейте вручную/);

  const already = setup(sent);
  await already.press(`o:rs:${ID}`);
  assert.equal(already.resent.length, 0);
});

test('«Еду отдали»: новый заказ принимается и закрывается выданным, без пушей клиенту', async () => {
  const { accepted, calls, press } = setup(failed);
  await press(`o:dv:${ID}`);
  assert.deepEqual(accepted.map((a) => [a[1], (a[3] as any)?.notify]), [['ACCEPTED', false], ['DELIVERED', false]]);
  const edit = calls.find((c) => c.method === 'editMessageText')!;
  assert.match(edit.payload.text, /Заказ №157 закрыт как выданный<\/b> — Айгерим/);
  assert.deepEqual(edit.payload.reply_markup.inline_keyboard, []);
});

import { cancelledByText, posterErrorText } from '../src/orders/orders.service';

test('ошибка Poster — только суть, без HTTP и JSON', () => {
  assert.equal(
    posterErrorText('Error: Poster incomingOrders.createIncomingOrder HTTP 404: {"error":99,"message":"products cannot be duplicated"}'),
    'products cannot be duplicated',
  );
  assert.equal(posterErrorText('Error: timeout'), 'timeout');
});

test('кто отменил: автомат больше не подписывается «оператором»', () => {
  assert.equal(cancelledByText('CUSTOMER'), 'клиентом');
  assert.equal(cancelledByText('ADMIN', 'Айгерим'), 'оператором (Айгерим)');
  assert.equal(cancelledByText('AUTO'), 'автоматически: 3 ч его никто не принял');
  assert.equal(cancelledByText('POSTER'), 'кассой: чек отклонён в Poster');
  assert.equal(cancelledByText(null), 'системой');
});

test('«Принять» не подтвердили за 30 с — кнопки сворачиваются, если заказ всё ещё новый', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: Array<{ method: string; payload: any }> = [];
  let status = 'NEW';
  const svc = new OrderActionsService(
    { order: { findFirst: async () => sent, findUnique: async () => ({ status }) } } as any,
    { call: async (_t: string, method: string, payload: any) => (calls.push({ method, payload }), { error: null }) } as any,
    {} as any, {} as any, {} as any,
  );
  const press = (data: string) =>
    svc.handle('t', { id: 'q', from: { id: 1 }, data, message: { message_id: 9, chat: { id: -100 } } }, 'Айгерим');

  await press(`o:a:${ID}`);
  t.mock.timers.tick(30_000);
  await new Promise((r) => setImmediate(r));
  const last = calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!;
  assert.deepEqual(last.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text), ['⋯ Действия']);

  // Нажали «Назад» до таймера — таймер ничего не трогает
  calls.length = 0;
  await press(`o:a:${ID}`);
  await press(`o:m:${ID}`);
  t.mock.timers.tick(30_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.filter((c) => c.method === 'editMessageReplyMarkup').length, 2);

  // Приняли на планшете, пока висела кнопка — не сворачиваем
  calls.length = 0;
  await press(`o:a:${ID}`);
  status = 'ACCEPTED';
  t.mock.timers.tick(30_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.filter((c) => c.method === 'editMessageReplyMarkup').length, 1);
});
