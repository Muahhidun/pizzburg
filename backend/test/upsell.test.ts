import assert from 'node:assert/strict';
import test from 'node:test';
import { UpsellService } from '../src/upsell/upsell.service';

/**
 * Подбор допродаж (DECISIONS §12.20).
 *
 * Fake отвечает так же, как Prisma: фильтрацию по категории и наличию
 * делает запрос, а вот отсев уже лежащего в корзине и просроченного
 * стопа — сервис, и проверяем именно это.
 */
function serviceWith(
  inCart: { id: string; appCategoryId: string | null }[],
  items: unknown[],
) {
  const seen: { where?: Record<string, unknown> } = {};
  const prisma = {
    product: { findMany: async () => inCart },
    upsellItem: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        seen.where = args.where;
        return items;
      },
    },
  };
  return { service: new UpsellService(prisma as never), seen };
}

function offer(
  id: string,
  extra: Record<string, unknown> = {},
  appCategoryId: string | null = null,
) {
  return {
    appCategoryId,
    product: {
      id,
      name: id,
      displayName: null,
      price: 500,
      priceOverride: null,
      photoUrl: null,
      displayPhotoUrl: null,
      weightLabel: null,
      stoppedUntil: null,
      appCategory: null,
      modifiers: [],
      comboGroups: [],
      ...extra,
    },
  };
}

const now = new Date('2026-08-21T12:00:00Z');

test('пустая корзина ничего не предлагает', async () => {
  const { service } = serviceWith([], [offer('sauce')]);
  assert.deepEqual(await service.suggest('t1', [], now), []);
});

test('спрашиваем и общий набор, и наборы категорий из корзины', async () => {
  const { service, seen } = serviceWith(
    [
      { id: 'pizza', appCategoryId: 'cat-pizza' },
      { id: 'burger', appCategoryId: 'cat-burger' },
      { id: 'noCat', appCategoryId: null },
    ],
    [],
  );
  await service.suggest('t1', ['pizza', 'burger', 'noCat'], now);

  assert.deepEqual(seen.where?.OR, [
    { appCategoryId: null },
    { appCategoryId: { in: ['cat-pizza', 'cat-burger'] } },
  ]);
  // То, что уже в корзине, не предлагаем — это отсекает сам запрос
  assert.deepEqual((seen.where?.product as Record<string, unknown>)?.id, {
    notIn: ['pizza', 'burger', 'noCat'],
  });
});

test('позиция на стопе не предлагается, даже если задача не отработала', async () => {
  const soon = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 60_000);
  const { service } = serviceWith(
    [{ id: 'pizza', appCategoryId: 'cat-pizza' }],
    [
      offer('stopped', { stoppedUntil: soon }),
      offer('byCategory', { appCategory: { stoppedUntil: soon } }),
      offer('expired', { stoppedUntil: past }),
      offer('fine'),
    ],
  );

  const names = (await service.suggest('t1', ['pizza'], now)).map((i) => i.name);
  assert.deepEqual(names, ['expired', 'fine']);
});

test('один товар предлагается один раз, даже если он в двух наборах', async () => {
  const { service } = serviceWith(
    [{ id: 'pizza', appCategoryId: 'cat-pizza' }],
    [offer('cola', {}, null), offer('cola', {}, 'cat-pizza')],
  );
  const result = await service.suggest('t1', ['pizza'], now);
  assert.equal(result.length, 1);
});

test('показываем не больше шести предложений', async () => {
  const many = Array.from({ length: 10 }, (_, i) => offer(`item${i}`));
  const { service } = serviceWith(
    [{ id: 'pizza', appCategoryId: 'cat-pizza' }],
    many,
  );
  assert.equal((await service.suggest('t1', ['pizza'], now)).length, 6);
});

test('цена и название берутся витринные, если они заданы', async () => {
  const { service } = serviceWith(
    [{ id: 'pizza', appCategoryId: 'cat-pizza' }],
    [
      offer('sauce', {
        displayName: 'Соус сырный',
        priceOverride: 250,
        displayPhotoUrl: 'https://example.test/s.jpg',
      }),
    ],
  );
  const [item] = await service.suggest('t1', ['pizza'], now);
  assert.equal(item.name, 'Соус сырный');
  assert.equal(item.price, 250);
  assert.equal(item.photoUrl, 'https://example.test/s.jpg');
});

test('позиции с обязательным выбором в допродажи не попадают', async () => {
  const { service } = serviceWith(
    [{ id: 'pizza', appCategoryId: 'cat-pizza' }],
    [
      offer('withModifiers', { modifiers: [{ name: 'Размер' }] }),
      offer('withCombo', { comboGroups: [{ id: 'g1' }] }),
      offer('oneTap'),
    ],
  );
  const names = (await service.suggest('t1', ['pizza'], now)).map((i) => i.name);
  // Добавление в один тап — иначе блок уводит из корзины в карточку
  assert.deepEqual(names, ['oneTap']);
});
