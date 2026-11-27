import assert from 'node:assert/strict';
import test from 'node:test';
import { handoverLines } from '../src/couriers/courier-cash.service';

/**
 * Карточка «Александр С. сдаёт 10 000 ₸» — за какие заказы (Дом,
 * 27.11.2026). Строки на вход — от новых к старым.
 */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

test('один заказ со сдачей: №357 — 10 000 (заказ 6 920 + сдача 3 080)', () => {
  assert.equal(
    plain(handoverLines([{ number: '357', external: false, order: 6920, change: 3080, owed: 10_000 }], 10_000)),
    'За заказы:\n• №357 — 10 000 ₸ (заказ 6 920 ₸ + сдача 3 080 ₸)',
  );
});

test('несколько заказов — от раннего к позднему, сданные раньше не попадают', () => {
  const text = plain(
    handoverLines(
      [
        { number: '323', external: false, order: 11_930, change: 0, owed: 11_930 },
        { number: '1622', external: true, order: 5650, change: 0, owed: 5650 },
        { number: '316', external: false, order: 7334, change: 0, owed: 7334 },
      ],
      17_580,
    ),
  );
  assert.equal(text, 'За заказы:\n• чек №1622 — 5 650 ₸\n• №323 — 11 930 ₸');
});

test('сумма меньше заказа — «часть из»', () => {
  assert.equal(
    plain(handoverLines([{ number: '323', external: false, order: 11_930, change: 0, owed: 11_930 }], 5000)),
    'За заказы:\n• №323 — 5 000 ₸ из 11 930 ₸',
  );
});

test('на руках больше, чем по заказам, — остаток отдельной строкой', () => {
  assert.equal(
    plain(handoverLines([{ number: '316', external: false, order: 7334, change: 0, owed: 7334 }], 22_574)),
    'За заказы:\n• №316 — 7 334 ₸\n• ещё 15 240 ₸ — с прошлых смен или поправка',
  );
});

test('заказ «оплатил картой» без сдачи — не в карточке', () => {
  assert.equal(handoverLines([{ number: '310', external: false, order: 2940, change: 0, owed: 0 }], 0), '');
});
