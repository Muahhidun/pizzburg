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
    // Без настройки потолка списание не ограничено: включать его молча
    // значило бы менять правила для тех, кто уже копил баллы
    maxSpendPct: 100,
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

test('потолок списания считается от товаров, а не от суммы к оплате', () => {
  // Баллами и так нельзя платить за доставку. Считать процент от суммы
  // с доставкой значило бы, что потолок растёт от расстояния
  const settings = { loyalty: { cashbackPct: 3, maxSpendPct: 30 } };
  assert.equal(loyalty.maxSpend(settings, 1100), 330);
});

test('без настройки баллами можно закрыть все товары', () => {
  assert.equal(loyalty.maxSpend({ loyalty: { cashbackPct: 3 } }, 1100), 1100);
});

test('мусор в настройке трактуется как «без ограничения»', () => {
  // Ноль и отрицательное значение выглядят как «запретить списание
  // совсем», но такое решение принимают отдельно, а не опечаткой в поле
  for (const bad of [0, -5, 140, 'много', null]) {
    assert.equal(
      loyalty.maxSpend({ loyalty: { maxSpendPct: bad } } as never, 1000),
      1000,
      `значение ${bad}`,
    );
  }
});
