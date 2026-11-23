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
    ...actionsButton(ID),
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
  const prisma = { order: { findFirst: async () => order } };
  const telegram = {
    call: async (_t: string, method: string, payload: any) => {
      calls.push({ method, payload });
      return { error: null };
    },
  };
  const orders = { cancelByOperator: async (...a: unknown[]) => cancels.push(a) };
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
  return { calls, cancels, marks, press };
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
