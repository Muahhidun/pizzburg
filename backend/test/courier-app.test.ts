import assert from 'node:assert/strict';
import test from 'node:test';
import { itemsLine, paymentLine } from '../src/couriers/assignment.service';
import {
  checklist,
  cityOf,
  formatAddress,
  mapUrl,
  missingItems,
} from '../src/couriers/courier-app.service';
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
  // Без города 2ГИС ищет там, где угадал по IP, — поэтому город точки
  assert.equal(
    decodeURIComponent(mapUrl(a, 'Экибастуз')!),
    'https://2gis.kz/search/Экибастуз Ауэзова 47б',
  );
  assert.equal(decodeURIComponent(mapUrl(a)!), 'https://2gis.kz/search/Ауэзова 47б');
  // Город уже в адресе — второй раз не добавляем
  assert.equal(
    decodeURIComponent(mapUrl({ street: 'Экибастуз, Ауэзова', house: '12' }, 'Экибастуз')!),
    'https://2gis.kz/search/Экибастуз, Ауэзова 12',
  );
  // С координатами — сразу маршрут от того места, где курьер сейчас
  assert.equal(
    decodeURIComponent(mapUrl({ ...a, lat: 51.72, lng: 75.32 }, 'Экибастуз')!),
    'https://2gis.kz/directions/points/|75.32,51.72',
  );
  assert.equal(mapUrl({ flat: '1' }), null);
});

test('город точки берётся из начала её адреса', () => {
  assert.equal(cityOf('Экибастуз, Ауэзова 47б, ТРЦ «MaxiMall», 3 этаж'), 'Экибастуз');
  assert.equal(cityOf('Ауэзова 47б'), '');
});

test('галочки комплектации: без снятых позиций, с добавками и подарком', () => {
  const lines = checklist([
    { id: 'a', name: 'Донер', qty: 2, modifiers: [{ name: 'Острый', price: 0 }, {}], isGift: false, isUnavailable: false },
    { id: 'b', name: 'Кола', qty: 1, modifiers: [], isGift: false, isUnavailable: true },
    { id: 'c', name: 'Бургер', qty: 1, modifiers: 'мусор', isGift: true, isUnavailable: false },
  ]);
  assert.deepEqual(lines, [
    { id: 'a', name: 'Донер', qty: 2, note: 'Острый' },
    { id: 'c', name: 'Бургер', qty: 1, note: 'подарок' },
  ]);
});

test('«Поехали» не пройдёт, пока не отмечены все позиции', () => {
  const items = [{ id: 'a' }, { id: 'c' }];
  assert.deepEqual(missingItems(items, ['a', 'c']), []);
  // Лишняя галочка (позицию сняли после отметки) не мешает
  assert.deepEqual(missingItems(items, ['a', 'b', 'c']), []);
  // Кассир добавил позицию, пока курьер отмечал старый список
  assert.deepEqual(missingItems(items, ['a']), ['c']);
});
