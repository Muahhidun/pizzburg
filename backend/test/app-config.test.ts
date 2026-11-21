import assert from 'node:assert/strict';
import test from 'node:test';
import { appConfigFrom } from '../src/app-link/app-link.controller';

/** Что приложение узнаёт о себе при запуске: минимальная версия и сторы */
test('минимальная версия и ссылки на сторы', () => {
  const c = appConfigFrom({
    appUpdate: { minIos: '1.0.1', minAndroid: '' },
    appLinks: { ios: 'https://apps.apple.com/x', android: 'https://play.google.com/y' },
  });
  assert.deepEqual(c.minVersion, { ios: '1.0.1', android: null });
  assert.deepEqual(c.store, {
    ios: 'https://apps.apple.com/x',
    android: 'https://play.google.com/y',
  });
  assert.equal(c.unpaidCancelMinutes, 30);
});

test('мусор вместо версии требований не создаёт', () => {
  const c = appConfigFrom({ appUpdate: { minIos: '1.0', minAndroid: 'latest' } });
  assert.deepEqual(c.minVersion, { ios: null, android: null });
  assert.deepEqual(appConfigFrom(null).minVersion, { ios: null, android: null });
});

test('подарок за вход: виден до последнего дня акции, потом пропадает', () => {
  const settings = {
    loyalty: { welcomeBonus: { amount: 1000, until: '2026-12-31', spendUntil: '2027-01-31' } },
  };
  // 31.12 23:00 по Алматы (UTC+5) — ещё акция
  assert.deepEqual(
    appConfigFrom(settings, new Date('2026-12-31T18:00:00Z')).welcomeBonus,
    { amount: 1000, until: '2026-12-31', spendUntil: '2027-01-31' },
  );
  // 1.01 00:30 по Алматы — уже нет
  assert.equal(appConfigFrom(settings, new Date('2026-12-31T19:30:00Z')).welcomeBonus, null);
  assert.equal(appConfigFrom({ loyalty: { welcomeBonus: { amount: 0 } } }).welcomeBonus, null);
  assert.equal(appConfigFrom(null).welcomeBonus, null);
});

test('баннеры сайта включены, пока их явно не выключили', () => {
  assert.deepEqual(appConfigFrom(null).webPromo, { popup: true, bar: true, qr: true });
  assert.deepEqual(
    appConfigFrom({ webPromo: { popup: false, qr: false } }).webPromo,
    { popup: false, bar: true, qr: false },
  );
});
