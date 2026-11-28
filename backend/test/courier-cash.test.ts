import assert from 'node:assert/strict';
import test from 'node:test';
import { isSeparate, netting, settlementOffset, settlementText } from '../src/couriers/courier-cash.service';

const plain = (v: string) => v.replace(/\s/g, ' ');

test('взаимозачёт: наличных больше заработка — курьер сдаёт разницу', () => {
  assert.deepEqual(netting(9600, 40000), { courierPays: 30400, venuePays: 0, offset: 9600 });
});

test('взаимозачёт: заработок больше наличных — касса доплачивает', () => {
  assert.deepEqual(netting(9600, 8000), { courierPays: 0, venuePays: 1600, offset: 8000 });
  assert.deepEqual(netting(4000, 0), { courierPays: 0, venuePays: 4000, offset: 0 });
});

test('текст расчёта говорит, кто кому и сколько отдаёт', () => {
  const base = { name: 'Азамат С.', deliveries: 12, earned: 9600 };
  assert.match(plain(settlementText({ ...base, cashHeld: 40000, courierPays: 30400, venuePays: 0 })), /Курьер сдаёт кассе 30 400 ₸/);
  assert.match(plain(settlementText({ ...base, cashHeld: 8000, courierPays: 0, venuePays: 1600 })), /Касса платит курьеру 1 600 ₸/);
  assert.match(settlementText({ ...base, cashHeld: 9600, courierPays: 0, venuePays: 0 }), /Никто никому не должен/);
});

test('раздельный расчёт (28.11.2026): касса платит весь заработок, наличные — отдельной карточкой', () => {
  const s = { name: 'Ансар Ш.', deliveries: 13, earned: 10_400, cashHeld: 8298, courierPays: 0, venuePays: 10_400 };
  assert.ok(isSeparate(s));
  const text = plain(settlementText(s));
  assert.match(text, /Касса платит курьеру 10 400 ₸/);
  assert.match(text, /Наличные 8 298 ₸ курьер сдаёт отдельно/);
  assert.doesNotMatch(text, /оставляет себе/);
  // Наличные в заработок не засчитываются — их снимет подтверждённая сдача
  assert.equal(settlementOffset(s), 0);
});

test('старые расчёты с зачётом закрываются как раньше', () => {
  // касса доплачивала 2 102 при 8 298 на руках
  assert.equal(settlementOffset({ earned: 10_400, venuePays: 2102 }), 8298);
  // курьер сдавал разницу: зачтён весь заработок
  assert.equal(settlementOffset({ earned: 9600, venuePays: 0 }), 9600);
  assert.ok(!isSeparate({ earned: 10_400, courierPays: 0, venuePays: 2102 }));
});
