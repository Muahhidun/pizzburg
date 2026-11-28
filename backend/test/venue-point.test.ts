import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressEntry, findLoose } from '../src/geo/address-search';
import { streetHouseOf } from '../src/couriers/batching';

/**
 * Точка раздачи (28.11.2026): адрес заведения «Экибастуз, Ауэзова 47б, ТРЦ…»,
 * а в справочнике — «улица Мухтара Ауэзова, 47Б». Точного совпадения нет,
 * и все связки за день шли «без координат», то есть в любую сторону.
 */

const entries: AddressEntry[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ekibastuz-addresses.json'), 'utf8'),
);

test('адрес заведения находит дом в справочнике', () => {
  const sh = streetHouseOf('Экибастуз, Ауэзова 47б, ТРЦ «MaxiMall», 3 этаж');
  assert.deepEqual(sh, { street: 'Ауэзова', house: '47б' });
  const found = findLoose(entries, sh!.street, sh!.house);
  assert.equal(found?.street, 'улица Мухтара Ауэзова');
  assert.equal(found?.house, '47Б');
});

test('адрес из Poster без «улица» тоже находится', () => {
  const found = findLoose(entries, 'Машхур Жусупа', '36');
  assert.equal(found?.street, 'улица Машхур Жусупа');
});

test('другой дом не подставляется: 47В ≠ 47Б', () => {
  assert.equal(findLoose(entries, 'Ауэзова', '47В')?.house ?? null, entries.find((e) => /Ауэзова/.test(e.street) && e.house === '47В')?.house ?? null);
  assert.equal(findLoose(entries, 'Ауэзова', '999'), null);
});
