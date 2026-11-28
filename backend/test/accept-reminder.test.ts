import assert from 'node:assert/strict';
import test from 'node:test';
import { AvailabilityService } from '../src/availability/availability.service';
import {
  AcceptReminderService,
  acceptResolvedText,
} from '../src/orders/accept-reminder.service';

/**
 * Напоминание о непринятом заказе: через 5 минут после отправки на
 * планшет — кассе, через 10 — руководству. Каждое ровно один раз.
 */
const now = new Date('2026-11-18T13:00:00Z');
const minAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function setup(order: Record<string, unknown>, claim = 1, resolved: unknown[] = []) {
  const cashier: string[] = [];
  const owner: string[] = [];
  const claims: unknown[] = [];
  const saved: unknown[] = [];
  const edits: any[] = [];
  const prisma = {
    order: {
      // Первый запрос — напоминания (status NEW), второй — итоги
      findMany: async (args: any) => (args.where.status === 'NEW' ? [order] : resolved),
      updateMany: async (args: unknown) => {
        claims.push(args);
        return { count: claim };
      },
      update: async (args: unknown) => saved.push(args),
    },
  };
  const telegram = {
    notifyCashier: async (_t: string, text: string) => {
      cashier.push(text);
      return { sent: true, chatId: '-100', messageId: 77 };
    },
    notify: async (_t: string, text: string) => owner.push(text),
    linkOrders: async (_t: string, text: string) => text,
    call: async (_t: string, method: string, payload: unknown) => {
      edits.push({ method, payload });
      return { error: null };
    },
  };
  return {
    service: new AcceptReminderService(
      prisma as never,
      telegram as never,
      new AvailabilityService(),
    ),
    cashier,
    owner,
    claims,
    saved,
    edits,
  };
}

const base = {
  id: 'o1',
  number: 116,
  tenantId: 't1',
  type: 'PICKUP',
  scheduledAt: null,
  acceptReminders: 0,
};

test('через 5 минут — касса, руководство молчит', async () => {
  const s = setup({
    ...base,
    dispatches: [{ status: 'SENT', sentAt: minAgo(6), posterStatus: null }],
  });
  await s.service.run(now);
  assert.equal(s.cashier.length, 1);
  assert.match(s.cashier[0], /№116 ждёт принятия 6 мин/);
  assert.equal(s.owner.length, 0);
});

test('через 10 минут — руководство', async () => {
  const s = setup({
    ...base,
    acceptReminders: 1,
    dispatches: [{ status: 'SENT', sentAt: minAgo(11), posterStatus: null }],
  });
  await s.service.run(now);
  assert.equal(s.cashier.length, 0);
  assert.match(s.owner[0], /№116 не принят уже 11 мин/);
});

test('уже напомнили — второй раз не шлём', async () => {
  const s = setup({
    ...base,
    acceptReminders: 1,
    dispatches: [{ status: 'SENT', sentAt: minAgo(7), posterStatus: null }],
  });
  await s.service.run(now);
  assert.equal(s.cashier.length + s.owner.length, 0);
  assert.equal(s.claims.length, 0);
});

test('другой экземпляр сервера успел первым — молчим', async () => {
  const s = setup(
    { ...base, dispatches: [{ status: 'SENT', sentAt: minAgo(6), posterStatus: null }] },
    0,
  );
  await s.service.run(now);
  assert.equal(s.cashier.length, 0);
});

test('предзаказ на потом не торопим', async () => {
  const s = setup({
    ...base,
    scheduledAt: new Date(now.getTime() + 3 * 3_600_000),
    dispatches: [{ status: 'SENT', sentAt: minAgo(20), posterStatus: null }],
  });
  await s.service.run(now);
  assert.equal(s.cashier.length + s.owner.length, 0);
});

test('напоминание кассе запоминает id сообщения', async () => {
  const s = setup({
    ...base,
    dispatches: [{ status: 'SENT', sentAt: minAgo(6), posterStatus: null }],
  });
  await s.service.run(now);
  assert.deepEqual((s.saved[0] as any).data, {
    acceptReminderChatId: '-100',
    acceptReminderMessageId: 77,
  });
});

test('после принятия сообщение переписывается на «принят через N мин»', async () => {
  const s = setup({ ...base, dispatches: [] }, 1, [
    {
      ...base,
      status: 'ACCEPTED',
      updatedAt: minAgo(1),
      cancelledAt: null,
      acceptReminderChatId: '-100',
      acceptReminderMessageId: 77,
      dispatches: [{ status: 'SENT', sentAt: minAgo(8) }],
    },
  ]);
  await s.service.run(now);
  assert.equal(s.edits.length, 1);
  assert.equal(s.edits[0].method, 'editMessageText');
  assert.equal(s.edits[0].payload.message_id, 77);
  assert.match(s.edits[0].payload.text, /✅ <b>Заказ №116 принят через 7 мин<\/b>/);
});

test('итог правится один раз: другой экземпляр успел первым', async () => {
  const s = setup({ ...base, dispatches: [] }, 0, [
    {
      ...base,
      status: 'ACCEPTED',
      updatedAt: minAgo(1),
      cancelledAt: null,
      acceptReminderChatId: '-100',
      acceptReminderMessageId: 77,
      dispatches: [{ status: 'SENT', sentAt: minAgo(8) }],
    },
  ]);
  await s.service.run(now);
  assert.equal(s.edits.length, 0);
});

test('отменённый без принятия — отдельный текст', () => {
  assert.match(
    acceptResolvedText(5, 'доставка', 'CANCELLED', undefined, now),
    /❌ <b>Заказ №5 отменён<\/b>/,
  );
});

/** Открыто 10:00–22:00 по Алматы (UTC+5) */
const hours = {
  timezone: 'Asia/Almaty',
  schedule: {
    profiles: [
      {
        id: 'base',
        name: 'Рабочее время',
        hours: Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['10:00', '22:00']]]),
        ),
      },
    ],
  },
};
// Заказ ушёл на планшет в 03:00 по местному (22:00 UTC накануне)
const nightOrder = {
  ...base,
  tenant: { settings: hours },
  dispatches: [{ status: 'SENT', sentAt: new Date('2026-11-21T22:00:00Z'), posterStatus: null }],
};

test('ночной заказ: пока закрыто — не напоминаем', async () => {
  const s = setup(nightOrder);
  await s.service.run(new Date('2026-11-22T03:00:00Z')); // 08:00
  assert.equal(s.cashier.length + s.owner.length, 0);
});

test('ночной заказ: минуты считаем с открытия в 10:00', async () => {
  const early = setup(nightOrder);
  await early.service.run(new Date('2026-11-22T05:03:00Z')); // 10:03
  assert.equal(early.cashier.length + early.owner.length, 0);

  const s = setup(nightOrder);
  await s.service.run(new Date('2026-11-22T05:06:00Z')); // 10:06
  assert.match(s.cashier[0], /ждёт принятия 6 мин/);
  assert.equal(s.owner.length, 0);
});

test('ночной заказ принят в 10:04 — «принят через 4 мин»', async () => {
  const s = setup({ ...base, dispatches: [] }, 1, [
    {
      ...nightOrder,
      status: 'ACCEPTED',
      updatedAt: new Date('2026-11-22T05:04:00Z'),
      cancelledAt: null,
      acceptReminderChatId: '-100',
      acceptReminderMessageId: 77,
    },
  ]);
  await s.service.run(new Date('2026-11-22T05:05:00Z'));
  assert.match(s.edits[0].payload.text, /принят через 4 мин/);
});

test('№357: напитки WeDrink приняли, чек PizzBurg не дошёл — заказ «Новый», напоминаем', async () => {
  let where: any;
  const s = setup({
    ...base,
    dispatches: [
      { status: 'SENT', sentAt: minAgo(6), posterStatus: 'ACCEPTED' },
      { status: 'FAILED', sentAt: null, posterStatus: null },
    ],
  });
  const prisma = (s.service as any).prisma;
  const orig = prisma.order.findMany;
  prisma.order.findMany = async (args: any) => {
    if (args.where.status === 'NEW') where = args.where;
    return orig(args);
  };
  await s.service.run(now);
  assert.equal(where.dispatches.some.posterStatus, undefined, 'принятая часть не прячет непринятый заказ');
  assert.equal(where.dispatches.some.OR, undefined);
  assert.match(s.cashier[0], /не дошла до Poster — пробейте её вручную/);
});
