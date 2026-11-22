import assert from 'node:assert/strict';
import test from 'node:test';
import { itemsLine, paymentLine } from '../src/couriers/assignment.service';
import { formatAddress, mapUrl } from '../src/couriers/courier-app.service';
import { signInitData, verifyInitData } from '../src/couriers/telegram-init-data';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000;
const user = JSON.stringify({ id: 555, first_name: 'Асхат' });

test('подписанные Telegram данные запуска принимаются', () => {
  const initData = signInitData({ auth_date: String(NOW - 60), user, query_id: 'q1' }, TOKEN);
  assert.equal(verifyInitData(initData, TOKEN, NOW)?.id, 555);
});

test('подменённый пользователь, чужой бот или старые данные не проходят', () => {
  const initData = signInitData({ auth_date: String(NOW - 60), user }, TOKEN);
  const forged = initData.replace(encodeURIComponent('555'), encodeURIComponent('777'));
  assert.equal(verifyInitData(forged, TOKEN, NOW), null);
  assert.equal(verifyInitData(initData, '999:OTHER', NOW), null);
  const old = signInitData({ auth_date: String(NOW - 2 * 24 * 3600), user }, TOKEN);
  assert.equal(verifyInitData(old, TOKEN, NOW), null);
  assert.equal(verifyInitData('', TOKEN, NOW), null);
});

test('оплата для курьера: наличные со сдачей, терминал, онлайн', () => {
  // toLocaleString ставит неразрывные пробелы между разрядами
  const plain = (v: string) => v.replace(/\s/g, ' ');
  assert.equal(
    plain(paymentLine({ cashToCollect: 6400, needsTerminal: false, changeFrom: 10000 })),
    'Наличные 6 400 ₸, сдача с 10 000 ₸',
  );
  assert.match(paymentLine({ cashToCollect: 0, needsTerminal: true }), /терминал/);
  assert.equal(paymentLine({ cashToCollect: 0, needsTerminal: false }), 'Оплачен онлайн');
});

test('состав без отсутствующих позиций', () => {
  assert.equal(
    itemsLine([
      { name: 'Донер', qty: 2, isUnavailable: false },
      { name: 'Кола', qty: 1, isUnavailable: true },
      { name: 'Фри', qty: 1, isUnavailable: false },
    ]),
    '2× Донер, Фри',
  );
});

test('адрес и ссылка на карту', () => {
  const a = { street: 'Ауэзова', house: '47б', entrance: '2', floor: '3', flat: '15' };
  assert.equal(formatAddress(a), 'Ауэзова, 47б; подъезд 2, этаж 3, кв. 15');
  assert.match(mapUrl(a)!, /^https:\/\/2gis\.kz\/search\//);
  assert.equal(mapUrl({ ...a, lat: 51.72, lng: 75.32 }), 'https://2gis.kz/geo/75.32,51.72');
});
