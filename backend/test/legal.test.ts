import assert from 'node:assert/strict';
import test from 'node:test';
import { LegalService } from '../src/legal/legal.service';
import { renderSupportPage } from '../src/legal/legal.controller';

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

test('страница поддержки показывает контакты и экранирует HTML', () => {
  const html = renderSupportPage({
    name: 'Cafe <One>',
    phone: '+7 (700) 123-45-67',
    email: 'help@example.kz',
    hours: 'ежедневно',
    address: 'Улица <1>',
  });

  assert.match(html, /Cafe &lt;One&gt;/);
  assert.match(html, /tel:\+77001234567/);
  assert.match(html, /mailto:help@example\.kz/);
  assert.match(html, /Запросить удаление/);
  assert.match(html, /subject=%D0%A3%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5/);
  assert.match(html, /Улица &lt;1&gt;/);
  assert.doesNotMatch(html, /<One>/);
});
