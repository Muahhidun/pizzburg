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
