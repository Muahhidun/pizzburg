import assert from 'node:assert/strict';
import test from 'node:test';
import { LoyaltyService } from '../src/loyalty/loyalty.service';

const loyalty = new LoyaltyService(null as never);

test('safe defaults forbid stacking benefits and cashback on discounted orders', () => {
  const policy = loyalty.policy({ loyalty: { cashbackPct: 3 } });
  assert.deepEqual(policy, {
    cashbackPct: 3,
    earnWhenPointsSpent: false,
    allowPointsWithPromotions: false,
    earnOnPromotionalOrders: false,
  });
  assert.equal(
    loyalty.cashbackAmount(
      { loyalty: { cashbackPct: 3 } },
      { subtotal: 5850, pointsSpent: 500, promotionalDiscount: 0 },
    ),
    0,
  );
  assert.equal(
    loyalty.cashbackAmount(
      { loyalty: { cashbackPct: 3 } },
      { subtotal: 6400, pointsSpent: 0, promotionalDiscount: 2550 },
    ),
    0,
  );
});

test('ordinary order earns cashback', () => {
  assert.equal(
    loyalty.cashbackAmount(
      { loyalty: { cashbackPct: 3 } },
      { subtotal: 5850, pointsSpent: 0, promotionalDiscount: 0 },
    ),
    175,
  );
});

test('admin can independently enable cashback exceptions', () => {
  const settings = {
    loyalty: {
      cashbackPct: 3,
      earnWhenPointsSpent: true,
      allowPointsWithPromotions: true,
      earnOnPromotionalOrders: true,
    },
  };
  assert.equal(
    loyalty.cashbackAmount(settings, {
      subtotal: 5850,
      pointsSpent: 500,
      promotionalDiscount: 2550,
    }),
    160,
  );
});
