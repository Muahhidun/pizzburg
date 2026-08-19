import assert from 'node:assert/strict';
import test from 'node:test';
import { ShortageService } from '../src/orders/shortage.service';

/**
 * Отказ отдела на планшете (DECISIONS §12.4 и §12.9).
 *
 * Кассира учат идти в консоль, а не жать «Отклонить», но правило на одной
 * дисциплине не держится. Проверяем, что нарушение приводит к правильному
 * результату: отказ ВТОРОГО отдела превращается в вопрос клиенту по
 * позициям, отказ ОСНОВНОГО сюда не попадает вовсе — он отменяет заказ
 * целиком, и спрашивать там нечего.
 */
function serviceFor(order: Record<string, unknown> | null) {
  const marked: { orderId: string; itemIds: string[] }[] = [];
  const toCashier: string[] = [];
  const prisma = { order: { findUnique: async () => order } };
  const telegram = {
    notifyCashier: async (_tenantId: string, text: string) => {
      toCashier.push(text);
      return { sent: true };
    },
  };

  const service = new ShortageService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    telegram as never,
    undefined as never,
  );
  (service as unknown as Record<string, unknown>).markUnavailable = async (
    _tenantId: string,
    orderId: string,
    itemIds: string[],
  ) => {
    marked.push({ orderId, itemIds });
    return {};
  };

  return { service, marked, toCashier };
}

/** Заказ «бургер из основного + раф из SunDay», отделы по порядку sortOrder */
const twoPartOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  number: 47,
  tenantId: 't1',
  status: 'ACCEPTED',
  shortageState: 'NONE',
  items: [
    { id: 'i-main', isGift: false, isUnavailable: false, product: { posterAccountId: 'main' } },
    { id: 'i-sun', isGift: false, isUnavailable: false, product: { posterAccountId: 'sun' } },
    { id: 'i-sun2', isGift: false, isUnavailable: false, product: { posterAccountId: 'sun' } },
  ],
  dispatches: [
    {
      id: 'd-main',
      posterAccountId: 'main',
      status: 'SENT',
      posterStatus: 'ACCEPTED',
      posterAccount: { name: 'Основной' },
    },
    {
      id: 'd-sun',
      posterAccountId: 'sun',
      status: 'SENT',
      posterStatus: 'REJECTED',
      posterAccount: { name: 'Sunday' },
    },
  ],
  ...overrides,
});

test('отказ второго отдела помечает все его позиции', async () => {
  const { service, marked } = serviceFor(twoPartOrder());

  await service.handleRejectedDepartments('o1');

  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0].itemIds, ['i-sun', 'i-sun2']);
});

test('отказ основного отдела здесь не обрабатывается — заказ отменяется целиком', async () => {
  const { service, marked } = serviceFor(
    twoPartOrder({
      dispatches: [
        {
          id: 'd-main',
          posterAccountId: 'main',
          status: 'SENT',
          posterStatus: 'REJECTED',
          posterAccount: { name: 'Основной' },
        },
        {
          id: 'd-sun',
          posterAccountId: 'sun',
          status: 'SENT',
          posterStatus: 'NEW',
          posterAccount: { name: 'Sunday' },
        },
      ],
    }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('идущее разбирательство второй раз не запускается', async () => {
  // Иначе каждый круг опроса сбрасывал бы клиенту срок ответа
  const { service, marked } = serviceFor(
    twoPartOrder({ shortageState: 'AWAITING_CUSTOMER' }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('после решения клиента отказ отдела ничего не меняет', async () => {
  const { service, marked } = serviceFor(
    twoPartOrder({ shortageState: 'KEPT_REST' }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('закрытый заказ не трогаем', async () => {
  const { service, marked } = serviceFor(
    twoPartOrder({ status: 'CANCELLED' }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('погашенная часть не считается за отдел заказа', async () => {
  // VOID — часть, в которой уже не осталось позиций. Если единственная
  // живая часть отказала, это отказ основного отдела, а не второго
  const { service, marked } = serviceFor(
    twoPartOrder({
      dispatches: [
        {
          id: 'd-main',
          posterAccountId: 'main',
          status: 'VOID',
          posterStatus: 'NEW',
          posterAccount: { name: 'Основной' },
        },
        {
          id: 'd-sun',
          posterAccountId: 'sun',
          status: 'SENT',
          posterStatus: 'REJECTED',
          posterAccount: { name: 'Sunday' },
        },
      ],
    }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('уже помеченные позиции не отмечаются заново', async () => {
  const { service, marked } = serviceFor(
    twoPartOrder({
      items: [
        { id: 'i-main', isGift: false, isUnavailable: false, product: { posterAccountId: 'main' } },
        { id: 'i-sun', isGift: false, isUnavailable: true, product: { posterAccountId: 'sun' } },
      ],
    }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked, []);
});

test('подарок отдела в пометку не попадает — он пересчитается сам', async () => {
  const { service, marked } = serviceFor(
    twoPartOrder({
      items: [
        { id: 'i-main', isGift: false, isUnavailable: false, product: { posterAccountId: 'main' } },
        { id: 'i-sun', isGift: false, isUnavailable: false, product: { posterAccountId: 'sun' } },
        { id: 'i-gift', isGift: true, isUnavailable: false, product: { posterAccountId: 'sun' } },
      ],
    }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(marked[0].itemIds, ['i-sun']);
});

test('соседний отдел узнаёт, что его напарник отказался', async () => {
  // Иначе он видит свой чек живым и готовит, не зная, что половина
  // заказа отвалилась и клиента уже спрашивают
  const { service, toCashier } = serviceFor(twoPartOrder());

  await service.handleRejectedDepartments('o1');

  assert.equal(toCashier.length, 1);
  assert.match(toCashier[0], /Sunday отклонил свою часть/);
  assert.match(toCashier[0], /Основной/);
});

test('когда отдел один, сообщать некому', async () => {
  const { service, toCashier } = serviceFor(
    twoPartOrder({
      dispatches: [
        {
          id: 'd-main',
          posterAccountId: 'main',
          status: 'VOID',
          posterStatus: 'NEW',
          posterAccount: { name: 'Основной' },
        },
        {
          id: 'd-sun',
          posterAccountId: 'sun',
          status: 'SENT',
          posterStatus: 'REJECTED',
          posterAccount: { name: 'Sunday' },
        },
      ],
    }),
  );

  await service.handleRejectedDepartments('o1');

  assert.deepEqual(toCashier, []);
});
