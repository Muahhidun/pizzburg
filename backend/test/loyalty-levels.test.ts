import assert from 'node:assert/strict';
import test from 'node:test';
import { LoyaltyService } from '../src/loyalty/loyalty.service';

/**
 * Уровни кэшбэка.
 *
 * Пороги — решение владельца от 15.08.2026: 3% с нуля, 4% от 50 000 ₸,
 * 5% от 100 000 ₸, 6% от 150 000 ₸. Оборот считается за всё время, и
 * уровень никогда не понижается.
 */
const service = new LoyaltyService(undefined as never);
const noSettings = {} as never;

test('новый клиент получает первый уровень и 3%', () => {
  const info = service.levelFor(noSettings, 0);
  assert.equal(info.current.level, 1);
  assert.equal(info.current.cashbackPct, 3);
  assert.equal(info.total, 4);
});

test('пороги совпадают с решением владельца', () => {
  assert.equal(service.levelFor(noSettings, 49_999).current.cashbackPct, 3);
  assert.equal(service.levelFor(noSettings, 50_000).current.cashbackPct, 4);
  assert.equal(service.levelFor(noSettings, 99_999).current.cashbackPct, 4);
  assert.equal(service.levelFor(noSettings, 100_000).current.cashbackPct, 5);
  assert.equal(service.levelFor(noSettings, 149_999).current.cashbackPct, 5);
  assert.equal(service.levelFor(noSettings, 150_000).current.cashbackPct, 6);
});

test('кэшбэк не растёт выше шести процентов', () => {
  const info = service.levelFor(noSettings, 10_000_000);
  assert.equal(info.current.cashbackPct, 6);
  assert.equal(info.next, null, 'выше максимума следующего уровня нет');
  assert.equal(info.toNext, 0);
});

test('до следующего уровня считается остаток, а не порог', () => {
  const info = service.levelFor(noSettings, 30_000);
  assert.equal(info.next?.cashbackPct, 4);
  assert.equal(info.toNext, 20_000, 'осталось 20 000, а не 50 000');
});

test('арендатор может задать свою лестницу', () => {
  const custom = {
    loyalty: {
      levels: [
        { level: 1, name: 'Старт', cashbackPct: 2, minSpent: 0 },
        { level: 2, name: 'Топ', cashbackPct: 10, minSpent: 1000 },
      ],
    },
  } as never;

  assert.equal(service.levelFor(custom, 0).current.cashbackPct, 2);
  assert.equal(service.levelFor(custom, 1000).current.cashbackPct, 10);
  assert.equal(service.levelFor(custom, 0).total, 2);
});

test('порядок уровней в настройках не обязан быть возрастающим', () => {
  const shuffled = {
    loyalty: {
      levels: [
        { level: 3, name: 'Третий', cashbackPct: 5, minSpent: 100_000 },
        { level: 1, name: 'Первый', cashbackPct: 3, minSpent: 0 },
        { level: 2, name: 'Второй', cashbackPct: 4, minSpent: 50_000 },
      ],
    },
  } as never;

  assert.equal(service.levelFor(shuffled, 60_000).current.cashbackPct, 4);
  assert.equal(service.levelFor(shuffled, 0).current.cashbackPct, 3);
});

test('процент кэшбэка берётся по уровню клиента', () => {
  // Именно это делало лестницу бессмысленной: раньше расчёт был прибит
  // к первому уровню и клиент четвёртого уровня получал те же 3%.
  assert.equal(service.cashbackPct(noSettings, 1), 3);
  assert.equal(service.cashbackPct(noSettings, 4), 6);
});
