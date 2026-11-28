import assert from 'node:assert/strict';
import test from 'node:test';
import { appVersionRefusal, isOlderVersion } from '../src/orders/app-version-gate';

/**
 * Заказы из устаревшего приложения (Дом, 28.11.2026): 1.0.0 не умеет
 * закрываться экраном «Обновите», поэтому отказ даёт сервер при заказе.
 */

const settings = { appUpdate: { minIos: '1.0.2', minAndroid: '1.0.2' } };

test('1.0.0 и 1.0.1 без заголовка версии — отказ с просьбой обновиться', () => {
  const text = appVersionRefusal(settings, { web: false });
  assert.match(text!, /Обновите PizzBurg в App Store или Google Play/);
});

test('новая версия и сайт — без отказа', () => {
  assert.equal(appVersionRefusal(settings, { web: false, version: '1.0.2', platform: 'ios' }), null);
  assert.equal(appVersionRefusal(settings, { web: false, version: '1.1.0', platform: 'android' }), null);
  assert.equal(appVersionRefusal(settings, { web: true }), null);
});

test('минимум не задан — проверка выключена', () => {
  assert.equal(appVersionRefusal({}, { web: false }), null);
  assert.equal(appVersionRefusal({ appUpdate: { minIos: '' } }, { web: false }), null);
});

test('платформа неизвестна — берём больший минимум', () => {
  const s = { appUpdate: { minIos: '1.0.3', minAndroid: '1.0.2' } };
  assert.ok(appVersionRefusal(s, { web: false, version: '1.0.2' }));
  assert.equal(appVersionRefusal(s, { web: false, version: '1.0.2', platform: 'android' }), null);
});

test('казахский текст по Accept-Language', () => {
  assert.match(appVersionRefusal(settings, { web: false, lang: 'kk' })!, /жаңартыңыз/);
});

test('сравнение версий', () => {
  assert.equal(isOlderVersion('1.0.1', '1.0.2'), true);
  assert.equal(isOlderVersion('1.0.10', '1.0.2'), false);
  assert.equal(isOlderVersion('1.0.2+7', '1.0.2'), false);
});
