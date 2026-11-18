import assert from 'node:assert/strict';
import test from 'node:test';
import { AcceptReminderService } from '../src/orders/accept-reminder.service';

/**
 * Напоминание о непринятом заказе: через 5 минут после отправки на
 * планшет — кассе, через 10 — руководству. Каждое ровно один раз.
 */
const now = new Date('2026-11-18T13:00:00Z');
const minAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function setup(order: Record<string, unknown>, claim = 1) {
  const cashier: string[] = [];
  const owner: string[] = [];
  const claims: unknown[] = [];
  const prisma = {
    order: {
      findMany: async () => [order],
      updateMany: async (args: unknown) => {
        claims.push(args);
        return { count: claim };
      },
    },
  };
  const telegram = {
    notifyCashier: async (_t: string, text: string) => cashier.push(text),
    notify: async (_t: string, text: string) => owner.push(text),
  };
  return {
    service: new AcceptReminderService(prisma as never, telegram as never),
    cashier,
    owner,
    claims,
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
