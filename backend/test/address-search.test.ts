import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AddressEntry,
  findExact,
  normalize,
  parseQuery,
  searchAddresses,
  searchHouses,
  searchStreets,
  streetKey,
  streetTokens,
} from '../src/geo/address-search';

/**
 * Поиск по адресному справочнику — на **настоящих** адресах Экибастуза
 * (7 663 записи, 308 улиц из OpenStreetMap), а не на выдуманных.
 *
 * Синтетическая пара «улица Ленина, 1» проверяет только то, что код
 * запускается. Здесь проверяется то, из-за чего человек не оформит заказ:
 * казахские названия, склонения, дома с литерами и дробями.
 */
const book: AddressEntry[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ekibastuz-addresses.json'), 'utf8'),
);

test('фикстура — это настоящий город, а не заглушка', () => {
  assert.ok(book.length > 7000, `адресов всего ${book.length}`);
  assert.ok(new Set(book.map((a) => a.street)).size > 300);
});

test('тип улицы не мешает: «абая» находит «улицу Абая»', () => {
  const streets = searchStreets(book, 'абая');
  assert.ok(streets.includes('улица Абая'), streets.join(' | '));
});

test('«улица абая» и «абая» дают один результат', () => {
  assert.deepEqual(
    searchStreets(book, 'улица абая'),
    searchStreets(book, 'абая'),
  );
});

test('казахское название находится по русскому написанию', () => {
  // В OSM проспект записан как «проспект Дінмұхамед Қонаев», а человек
  // печатает «Конаев» — без замены казахской кириллицы он свой дом не найдёт.
  const streets = searchStreets(book, 'конаев');
  assert.ok(
    streets.some((s) => s.includes('онаев')),
    streets.join(' | '),
  );
});

test('склонение не ломает поиск: «конаева» тоже находит', () => {
  // Запрос длиннее хранимого слова — обычный префикс здесь не работает.
  const streets = searchStreets(book, 'конаева');
  assert.ok(
    streets.some((s) => s.includes('онаев')),
    streets.join(' | '),
  );
});

test('часть слова с начала: «берким» → Беркимбаева', () => {
  assert.ok(searchStreets(book, 'берким').includes('улица Беркимбаева'));
});

test('совпадение с начала названия ценнее совпадения в середине', () => {
  // «бухар» — это «Бухар Жырау», а не «улица имени кого-то Бухаровича»
  const streets = searchStreets(book, 'бухар');
  assert.equal(streets[0], 'улица Бухар Жырау');
});

test('одна улица не двоится из-за разного написания в OSM', () => {
  // «улица Бухар Жырау» (168 домов) и «Бухар Жырау» (12) — одна улица.
  // Две строки в подсказках человек прочитает как ошибку приложения.
  const streets = searchStreets(book, 'бухар');
  assert.deepEqual(streets, ['улица Бухар Жырау']);
});

test('дома находятся независимо от того, как записана улица', () => {
  // Дом может стоять под коротким написанием, а выбрал человек длинное
  const houses = searchHouses(book, 'улица Бухар Жырау');
  const short = searchHouses(book, 'Бухар Жырау');
  assert.ok(houses.length > 0);
  assert.deepEqual(
    houses.map((h) => h.house),
    short.map((h) => h.house),
  );
});

test('улица с номером вместо названия находится: «207 квартал»', () => {
  // Голая цифра — это название, а не номер дома: иначе такая улица
  // не находится вообще никак.
  const streets = searchStreets(book, '207');
  assert.ok(streets.some((s) => s.includes('207')), streets.join(' | '));
});

test('«12-я линейная 5» — дом 5, а не дом 12', () => {
  const parsed = parseQuery('12-я линейная 5');
  assert.equal(parsed.house, '5');
  assert.deepEqual(parsed.words, ['12', 'я', 'линейная']);
});

test('пока номера нет, отдаём улицы, а не 217 домов одной улицы', () => {
  const items = searchAddresses(book, 'беркимбаева');
  assert.equal(items.length, 0);
  assert.ok(searchStreets(book, 'беркимбаева').length > 0);
});

test('улица и дом одной строкой дают готовый адрес', () => {
  const items = searchAddresses(book, 'абая 38');
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => normalize(i.street).includes('абая')));
  assert.ok(items[0].house.startsWith('38'));
});

test('дома сортируются по-человечески: 2, 10, 100, а не 10, 100, 2', () => {
  const houses = searchHouses(book, 'улица Абая').map((h) => h.house);
  const numeric = houses.filter((h) => /^\d+$/.test(h)).map(Number);
  const sorted = [...numeric].sort((a, b) => a - b);
  assert.deepEqual(numeric, sorted, houses.join(', '));
});

test('дом с литерой находится и по цифре, и целиком', () => {
  const withLetter = book.find((a) => /^\d+[А-Яа-я]$/.test(a.house));
  assert.ok(withLetter, 'в городе должны быть дома вида 12А');

  const byDigits = searchHouses(
    book,
    withLetter!.street,
    withLetter!.house.replace(/\D/g, ''),
  );
  assert.ok(byDigits.some((h) => h.house === withLetter!.house));

  const full = searchHouses(book, withLetter!.street, withLetter!.house);
  assert.ok(full.some((h) => h.house === withLetter!.house));
});

test('регистр дома не важен: «12а» и «12А» — один дом', () => {
  const entry = book.find((a) => /^\d+[А-Я]$/.test(a.house))!;
  assert.ok(findExact(book, entry.street, entry.house.toLowerCase()));
});

test('несуществующий дом не подтверждается', () => {
  assert.equal(findExact(book, 'улица Абая', '99999'), null);
});

test('несуществующая улица не находится', () => {
  assert.deepEqual(searchStreets(book, 'ъъъъъ'), []);
});

test('одна буква не должна совпадать со всем городом', () => {
  const { words } = parseQuery('а');
  const streets = searchStreets(book, 'а');
  // Поиск от одной буквы бессмысленен, но он не должен и падать
  assert.equal(words.length, 1);
  assert.ok(streets.length <= 8);
});

test('номер дома отделяется от названия', () => {
  assert.deepEqual(parseQuery('бухар жырау 12а'), {
    words: ['бухар', 'жырау'],
    house: '12а',
  });
});

test('нормализация схлопывает ё и казахские буквы', () => {
  assert.equal(normalize('Берёзовая'), 'березовая');
  assert.equal(normalize('Қонаев'), 'конаев');
  assert.equal(normalize('  улица   Абая  '), 'улица абая');
});

test('тип улицы выкидывается, название остаётся', () => {
  assert.deepEqual(streetTokens('проспект Дінмұхамед Қонаев'), [
    'динмухамед',
    'конаев',
  ]);
  assert.deepEqual(streetTokens('12-й Северный переулок'), ['12', 'й', 'северный']);
});

test('каждая улица города находится по своему же названию', () => {
  // Самая важная проверка: справочник бесполезен, если по части улиц
  // поиск молчит. Берём каждое название и ищем его последнее слово.
  // Сравниваем по ключу: подсказка отдаёт каноническое написание, а в
  // справочнике та же улица может лежать и под сокращённым.
  const streets = [...new Set(book.map((a) => a.street))];
  const missed: string[] = [];
  for (const street of streets) {
    const tokens = streetTokens(street);
    const probe = tokens[tokens.length - 1];
    if (!probe || probe.length < 3) continue;
    const found = searchStreets(book, probe, 50).map(streetKey);
    if (!found.includes(streetKey(street))) missed.push(street);
  }
  assert.deepEqual(missed, []);
});

test('весь город ищется быстрее, чем человек печатает следующую букву', () => {
  // Справочник живёт в памяти именно ради этого: подсказка не должна
  // отставать от ввода.
  const started = Date.now();
  for (const q of ['абая', 'берким', 'конаева', 'бухар жырау 12', 'машхур']) {
    searchStreets(book, q);
    searchAddresses(book, q);
  }
  const perQuery = (Date.now() - started) / 5;
  assert.ok(perQuery < 50, `${perQuery} мс на запрос`);
});
