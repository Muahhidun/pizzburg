import assert from 'node:assert/strict';
import test from 'node:test';
import { LegalService } from '../src/legal/legal.service';

/** Заглушка Prisma: нужен только currentVersions для pendingConsent */
function serviceWith(current: Record<string, number>) {
  const prisma = {
    legalDocument: {
      findMany: async () =>
        Object.entries(current).map(([type, version]) => ({ type, version })),
    },
  };
  return new LegalService(prisma as never);
}

test('без принятого согласия оба обязательных документа в списке', async () => {
  const legal = serviceWith({ OFFER: 1, PRIVACY: 1 });
  const pending = await legal.pendingConsent('t1', {});
  assert.deepEqual(pending, [
    { type: 'OFFER', version: 1 },
    { type: 'PRIVACY', version: 1 },
  ]);
});

test('принятые актуальные версии не требуют повторного согласия', async () => {
  const legal = serviceWith({ OFFER: 2, PRIVACY: 1 });
  const pending = await legal.pendingConsent('t1', { OFFER: 2, PRIVACY: 1 });
  assert.deepEqual(pending, []);
});

test('новая редакция оферты снова требует согласия', async () => {
  const legal = serviceWith({ OFFER: 3, PRIVACY: 1 });
  // клиент принимал вторую редакцию оферты
  const pending = await legal.pendingConsent('t1', { OFFER: 2, PRIVACY: 1 });
  assert.deepEqual(pending, [{ type: 'OFFER', version: 3 }]);
});

test('реквизиты согласия не требуют — это справочный документ', async () => {
  const legal = serviceWith({ OFFER: 1, PRIVACY: 1, REQUISITES: 5 });
  const pending = await legal.pendingConsent('t1', { OFFER: 1, PRIVACY: 1 });
  assert.deepEqual(pending, []);
});

test('неопубликованный документ не блокирует заказ', async () => {
  // политика ещё не опубликована — требовать нечего
  const legal = serviceWith({ OFFER: 1 });
  const pending = await legal.pendingConsent('t1', { OFFER: 1 });
  assert.deepEqual(pending, []);
});
