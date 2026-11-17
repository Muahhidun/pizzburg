import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESSAGE_COOLDOWN_MS,
  MESSAGE_LIMIT_PER_ORDER,
  OrderMessagesService,
  QUICK_REPLIES,
  replyKeyboard,
} from '../src/orders/order-messages.service';

/**
 * Связь с заведением по живому заказу (DECISIONS §12.21).
 *
 * Кнопка печатает в живой чат смены, поэтому проверяем ровно то, что её
 * защищает: закрытый заказ, «где мой заказ» не раньше срока, частота и
 * предел на заказ. И ответ кассира: один, с пушем клиенту.
 */
const now = new Date('2026-08-21T12:00:00Z');
const hourAgo = new Date(now.getTime() - 61 * 60_000);

type Row = {
  id: string;
  topic: string;
  text: string;
  createdAt: Date;
  answerText: string | null;
  answeredAt: Date | null;
};

function serviceWith({
  order,
  thread = [],
  answered = false,
}: {
  order: Record<string, unknown>;
  thread?: Row[];
  answered?: boolean;
}) {
  const sent: { text: string; keyboard?: unknown }[] = [];
  const created: unknown[] = [];
  const updates: unknown[] = [];
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const pushes: { body: string; data: unknown }[] = [];
  const last = thread[thread.length - 1] ?? null;
  const prisma = {
    order: { findUnique: async () => order },
    orderMessage: {
      count: async () => thread.length,
      findFirst: async () => last,
      findMany: async () => thread,
      create: async ({ data }: { data: unknown }) => {
        created.push(data);
        return { id: 'm1' };
      },
      update: async (args: unknown) => updates.push(args),
      updateMany: async () => ({ count: answered ? 0 : 1 }),
      findUniqueOrThrow: async () => ({
        topic: 'WHERE',
        text: '',
        telegramChatId: '-100',
        telegramMessageId: 77,
        order: { ...order, tenant: { settings: {} } },
      }),
    },
  };
  const telegram = {
    notifyCashier: async (_t: string, text: string, keyboard?: unknown) => {
      sent.push({ text, keyboard });
      return { sent: true, chatId: '-100', messageId: 77 };
    },
    call: async (_t: string, method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      return { error: null };
    },
  };
  const notifications = {
    sendOrderEvent: async (
      _id: string,
      build: (lang: string) => { body: string },
      data: unknown,
    ) => {
      pushes.push({ body: build('ru').body, data });
    },
  };
  return {
    service: new OrderMessagesService(
      prisma as never,
      telegram as never,
      notifications as never,
    ),
    sent,
    created,
    updates,
    calls,
    pushes,
  };
}

const liveOrder = {
  id: 'o1',
  number: 42,
  type: 'DELIVERY',
  status: 'ACCEPTED',
  tenantId: 't1',
  address: { street: 'Сатпаева', house: '38А', flat: '3' },
  customer: { phone: '+77070000000' },
  createdAt: hourAgo,
  scheduledAt: null,
  tenant: { settings: {} },
};

const row = (minutesAgo: number, over: Partial<Row> = {}): Row => ({
  id: `m${minutesAgo}`,
  topic: 'MISSING',
  text: '',
  createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  answerText: null,
  answeredAt: null,
  ...over,
});

test('обращение уходит кассе с номером, темой, телефоном и кнопками', async () => {
  const { service, sent, updates } = serviceWith({ order: liveOrder });
  await service.send('o1', { topic: 'WHERE' }, now);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /№42/);
  assert.match(sent[0].text, /Где мой заказ\?/);
  assert.match(sent[0].text, /\+77070000000/);
  assert.match(sent[0].text, /Сатпаева 38А, кв\. 3/);
  // Готовые ответы и «свой ответ» под сообщением
  assert.deepEqual(sent[0].keyboard, replyKeyboard('m1', 'WHERE'));
  // Запомнили, где лежит вопрос, — по нему поймаем ответ
  assert.deepEqual(updates, [
    {
      where: { id: 'm1' },
      data: { telegramChatId: '-100', telegramMessageId: 77 },
    },
  ]);
});

test('«Где мой заказ?» не раньше срока из настроек', async () => {
  const fresh = { ...liveOrder, createdAt: new Date(now.getTime() - 20 * 60_000) };
  const early = serviceWith({ order: fresh });
  await assert.rejects(
    () => early.service.send('o1', { topic: 'WHERE' }, now),
    /можно с \d\d:\d\d/,
  );
  assert.equal(early.sent.length, 0);

  // Остальные темы — с первой минуты: адрес и забытую позицию
  // исправлять нужно сразу
  await early.service.send('o1', { topic: 'ADDRESS' }, now);
  assert.equal(early.sent.length, 1);

  // Срок меняется в настройках: 15 минут — и через 20 уже можно
  const short = serviceWith({
    order: { ...fresh, tenant: { settings: { messages: { whereAfterMinutes: 15 } } } },
  });
  await short.service.send('o1', { topic: 'WHERE' }, now);
  assert.equal(short.sent.length, 1);
});

test('у предзаказа «где мой заказ» — со времени, на которое заказали', async () => {
  const preorder = {
    ...liveOrder,
    createdAt: new Date(now.getTime() - 3 * 3_600_000),
    scheduledAt: new Date(now.getTime() + 30 * 60_000),
  };
  const { service } = serviceWith({ order: preorder });
  await assert.rejects(() => service.send('o1', { topic: 'WHERE' }, now), /можно с/);
});

test('свободный текст попадает в сообщение, но тема остаётся', async () => {
  const { service, sent, created } = serviceWith({ order: liveOrder });
  await service.send('o1', { topic: 'MISSING', text: '  забыли соус  ' }, now);

  assert.match(sent[0].text, /Забыли позицию/);
  assert.match(sent[0].text, /«забыли соус»/);
  assert.equal((created[0] as { text: string }).text, 'забыли соус');
});

test('самовывоз не выдумывает адрес', async () => {
  const { service, sent } = serviceWith({
    order: { ...liveOrder, type: 'PICKUP', address: null },
  });
  await service.send('o1', { topic: 'WHERE' }, now);
  assert.match(sent[0].text, /самовывоз/);
});

test('неизвестная тема отклоняется', async () => {
  const { service } = serviceWith({ order: liveOrder });
  await assert.rejects(
    () => service.send('o1', { topic: 'HACK' }, now),
    /Неизвестная тема/,
  );
});

test('по закрытому заказу писать некуда', async () => {
  for (const status of ['DELIVERED', 'CANCELLED']) {
    const { service, sent } = serviceWith({ order: { ...liveOrder, status } });
    await assert.rejects(
      () => service.send('o1', { topic: 'WHERE' }, now),
      /уже закрыт/,
    );
    assert.equal(sent.length, 0);
  }
});

test('между сообщениями — 10 минут', async () => {
  assert.equal(MESSAGE_COOLDOWN_MS, 10 * 60_000);
  const { service, sent } = serviceWith({ order: liveOrder, thread: [row(9)] });
  await assert.rejects(
    () => service.send('o1', { topic: 'MISSING' }, now),
    /через 10 минут/,
  );
  assert.equal(sent.length, 0);

  const ok = serviceWith({ order: liveOrder, thread: [row(11)] });
  await ok.service.send('o1', { topic: 'MISSING' }, now);
  assert.equal(ok.sent.length, 1);
});

test('больше трёх сообщений на заказ не принимаем', async () => {
  const { service, sent } = serviceWith({
    order: liveOrder,
    thread: [row(60), row(45), row(30)],
  });
  assert.equal(MESSAGE_LIMIT_PER_ORDER, 3);
  await assert.rejects(
    () => service.send('o1', { topic: 'OTHER', text: 'ещё' }, now),
    /уже получили ваши сообщения/,
  );
  assert.equal(sent.length, 0);
});

test('состояние видно до нажатия: пауза, срок «где мой заказ», переписка', async () => {
  const fresh = { ...liveOrder, createdAt: new Date(now.getTime() - 20 * 60_000) };
  const empty = serviceWith({ order: fresh });
  const s0 = await empty.service.state('o1', now);
  assert.equal(s0.sent, 0);
  assert.equal(s0.nextAllowedAt, null);
  assert.equal(
    s0.whereAllowedAt,
    new Date(fresh.createdAt.getTime() + 60 * 60_000).toISOString(),
  );
  assert.deepEqual(s0.thread, []);

  const answeredAt = new Date(now.getTime() - 60_000);
  const talk = serviceWith({
    order: liveOrder,
    thread: [row(2, { answerText: 'Приняли, всё положим', answeredAt })],
  });
  const s1 = await talk.service.state('o1', now);
  assert.equal(s1.whereAllowedAt, null);
  assert.equal(
    s1.nextAllowedAt,
    new Date(now.getTime() - 2 * 60_000 + MESSAGE_COOLDOWN_MS).toISOString(),
  );
  assert.equal(s1.thread[0].label, 'Забыли позицию');
  assert.equal(s1.thread[0].answerText, 'Приняли, всё положим');

  // Лимит исчерпан: ждать нечего, поэтому времени не обещаем
  const done = serviceWith({ order: liveOrder, thread: [row(30), row(20), row(1)] });
  assert.equal((await done.service.state('o1', now)).nextAllowedAt, null);
});

test('ответ кассира: пуш клиенту и вопрос в группе с ответом и именем', async () => {
  const { service, calls, pushes } = serviceWith({ order: liveOrder });
  const result = await service.answer('m1', QUICK_REPLIES.WHERE[1], 'Альбина', now);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(pushes, [
    { body: 'Курьер уже в пути', data: { type: 'order_reply' } },
  ]);
  const edit = calls.find((c) => c.method === 'editMessageText');
  assert.ok(edit);
  assert.equal(edit.payload.message_id, 77);
  assert.match(String(edit.payload.text), /Где мой заказ\?/);
  assert.match(String(edit.payload.text), /↩️ <b>Альбина<\/b>, \d\d:\d\d: Курьер уже в пути/);
  // Кнопки уходят вместе с переписыванием: reply_markup не передан
  assert.equal(edit.payload.reply_markup, undefined);
});

test('второй ответ на тот же вопрос не уходит клиенту', async () => {
  const { service, pushes, calls } = serviceWith({ order: liveOrder, answered: true });
  const result = await service.answer('m1', 'Сейчас перезвоним', 'Мадина', now);
  assert.deepEqual(result, { ok: false, reason: 'Уже ответили' });
  assert.equal(pushes.length, 0);
  assert.equal(calls.length, 0);
});

test('callback_data укладывается в 64 байта Телеграма', () => {
  const id = 'c'.repeat(25);
  for (const topic of Object.keys(QUICK_REPLIES)) {
    for (const row of replyKeyboard(id, topic)) {
      for (const b of row) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
    }
  }
});
