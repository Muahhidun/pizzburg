import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appLinksFrom,
  renderAppLinkPage,
  storeFor,
} from '../src/app-link/app-link.controller';

const links = {
  ios: 'https://apps.apple.com/kz/app/id6806758471',
  android: 'https://play.google.com/store/apps/details?id=kz.pizzburg.pizzburg',
};

test('iPhone и Instagram на iPhone уходят в App Store', () => {
  assert.equal(
    storeFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram 300.0', links),
    links.ios,
  );
});

test('Android уходит в Google Play', () => {
  assert.equal(
    storeFor('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36', links),
    links.android,
  );
});

test('компьютер видит страницу', () => {
  assert.equal(
    storeFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', links),
    undefined,
  );
  assert.equal(storeFor(undefined, links), undefined);
});

test('берём только https-ссылки из настроек', () => {
  assert.deepEqual(
    appLinksFrom({ appLinks: { ios: 'javascript:alert(1)', android: links.android } }),
    { ios: undefined, android: links.android, promo: undefined },
  );
  assert.deepEqual(appLinksFrom(null), {
    ios: undefined,
    android: undefined,
    promo: undefined,
  });
});

test('страница экранирует акцию и показывает обе кнопки', () => {
  const html = renderAppLinkPage({ name: 'PizzBurg', ...links, promo: '<b>-20%</b>' });
  assert.match(html, /Скачать в App Store/);
  assert.match(html, /Скачать в Google Play/);
  assert.match(html, /&lt;b&gt;-20%&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>-20%/);
});
