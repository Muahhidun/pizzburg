import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLoyaltyLevels } from '../src/admin/admin.service';

/**
 * Редактирование лестницы кэшбэка из админки.
 *
 * Проверяем не форму, а инварианты: клиентский `loyaltyLevel` — это номер
 * ступени, поэтому перенумерация после сортировки обязательна, иначе
 * перестановка строк в форме молча меняет процент существующим клиентам.
 */

test('ступени нумеруются заново по возрастанию порога', () => {
  const levels = normalizeLoyaltyLevels([
    { name: 'Постоянный', cashbackPct: 6, minSpent: 150_000 },
    { name: 'Новичок', cashbackPct: 3, minSpent: 0 },
    { name: 'Свой', cashbackPct: 4, minSpent: 50_000 },
  ]);
  assert.deepEqual(
    levels.map((l) => [l.level, l.name, l.cashbackPct]),
    [
      [1, 'Новичок', 3],
      [2, 'Свой', 4],
      [3, 'Постоянный', 6],
    ],
  );
});

test('первая ступень обязана начинаться с нуля', () => {
  assert.throws(
    () =>
      normalizeLoyaltyLevels([
        { name: 'Свой', cashbackPct: 4, minSpent: 50_000 },
      ]),
    /0 ₸/,
  );
});

test('лестница не может идти вниз', () => {
  assert.throws(
    () =>
      normalizeLoyaltyLevels([
        { name: 'Новичок', cashbackPct: 5, minSpent: 0 },
        { name: 'Постоянный', cashbackPct: 4, minSpent: 100_000 },
      ]),
    /меньший кэшбэк/,
  );
});

test('два уровня с одним порогом отвергаются', () => {
  assert.throws(
    () =>
      normalizeLoyaltyLevels([
        { name: 'Новичок', cashbackPct: 3, minSpent: 0 },
        { name: 'Дубль', cashbackPct: 4, minSpent: 0 },
      ]),
    /одинаковым порогом/,
  );
});

test('пустая лестница отвергается', () => {
  assert.throws(() => normalizeLoyaltyLevels([]), /хотя бы один/);
});

test('одинаковый процент на соседних ступенях допустим', () => {
  // Владелец вправе сделать «плато»: 3% до 50 000 и 3% до 100 000 —
  // это не ошибка, а способ растянуть лестницу по названиям.
  const levels = normalizeLoyaltyLevels([
    { name: 'Новичок', cashbackPct: 3, minSpent: 0 },
    { name: 'Свой', cashbackPct: 3, minSpent: 50_000 },
  ]);
  assert.equal(levels.length, 2);
});
