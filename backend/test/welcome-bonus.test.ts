import assert from 'node:assert/strict';
import test from 'node:test';
import { LoyaltyService } from '../src/loyalty/loyalty.service';

/** Минимальная подделка Prisma: один клиент и условный UPDATE */
function fakePrisma(settings: unknown, customer: Record<string, unknown> = {}) {
  const state = {
    welcomeBonusAt: null as Date | null,
    deletedAt: null as Date | null,
    pointsBalance: 0,
    txns: [] as any[],
    ...customer,
  };
  const db: any = {
    customer: {
      findUnique: async () => ({
        tenantId: 't1',
        welcomeBonusAt: state.welcomeBonusAt,
        deletedAt: state.deletedAt,
        tenant: { settings },
      }),
      updateMany: async ({ data }: any) => {
        if (state.welcomeBonusAt || state.deletedAt) return { count: 0 };
        state.welcomeBonusAt = data.welcomeBonusAt;
        state.pointsBalance += data.pointsBalance.increment;
        return { count: 1 };
      },
    },
    loyaltyTransaction: {
      create: async ({ data }: any) => state.txns.push(data),
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, state };
}

const pushes: string[] = [];
const notifications: any = {
  sendToCustomer: async (_id: string, build: any) => pushes.push(build('ru').title),
};

const ACTIVE = { loyalty: { welcomeBonus: { amount: 1000, until: '2026-12-15' } } };
const DAY = new Date('2026-11-20T06:00:00Z');

test('grants the welcome bonus once', async () => {
  const { db, state } = fakePrisma(ACTIVE);
  const loyalty = new LoyaltyService(db, notifications);
  assert.equal(await loyalty.grantWelcomeBonus('c1', DAY), 1000);
  assert.equal(await loyalty.grantWelcomeBonus('c1', DAY), 0);
  assert.equal(state.pointsBalance, 1000);
  assert.equal(state.txns.length, 1);
  assert.equal(state.txns[0].comment, 'Подарок за вход в приложение');
  assert.match(pushes.at(-1)!, /1000 баллов/);
});

test('last day is inclusive in the venue time zone', async () => {
  // 15.12 23:30 в Экибастузе (UTC+5) — ещё акция
  const { db } = fakePrisma(ACTIVE);
  const loyalty = new LoyaltyService(db, notifications);
  assert.equal(
    await loyalty.grantWelcomeBonus('c1', new Date('2026-12-15T18:30:00Z')),
    1000,
  );
  // 16.12 00:30 — уже нет
  const late = fakePrisma(ACTIVE);
  assert.equal(
    await new LoyaltyService(late.db, notifications).grantWelcomeBonus(
      'c1',
      new Date('2026-12-15T19:30:00Z'),
    ),
    0,
  );
});

test('no bonus when switched off or for deleted accounts', async () => {
  const off = fakePrisma({ loyalty: { welcomeBonus: { amount: 0 } } });
  assert.equal(await new LoyaltyService(off.db, notifications).grantWelcomeBonus('c1', DAY), 0);
  const none = fakePrisma({});
  assert.equal(await new LoyaltyService(none.db, notifications).grantWelcomeBonus('c1', DAY), 0);
  const deleted = fakePrisma(ACTIVE, { deletedAt: new Date() });
  assert.equal(await new LoyaltyService(deleted.db, notifications).grantWelcomeBonus('c1', DAY), 0);
});

test('without an end date the bonus has no deadline', async () => {
  const { db } = fakePrisma({ loyalty: { welcomeBonus: { amount: 500 } } });
  assert.equal(await new LoyaltyService(db, notifications).grantWelcomeBonus('c1', DAY), 500);
});
