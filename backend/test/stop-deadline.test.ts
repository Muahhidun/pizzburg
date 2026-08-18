import assert from 'node:assert/strict';
import test from 'node:test';
import { stopDeadline, type ScheduleLookup } from '../src/stoplist/stop-deadline';

/**
 * Сроки стоп-листа (DECISIONS §12.3).
 *
 * Проверяем не арифметику ради арифметики: ошибка здесь возвращает
 * позицию в продажу посреди ночи или, наоборот, держит стоп лишние
 * сутки — а стоп-лист со сроком затевался ровно ради того, чтобы забыть
 * вернуть позицию было невозможно.
 */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Заведение работает 10:00–22:00 каждый день */
const daily = (nowMinutes: number): ScheduleLookup => ({
  nowMinutes,
  hoursOn: () => [['10:00', '22:00']],
});

const NOW = new Date('2026-08-18T09:00:00Z');
const minutesBetween = (later: Date) => (later.getTime() - NOW.getTime()) / 60000;

test('час и два часа считаются от текущего момента', () => {
  assert.equal(minutesBetween(stopDeadline('HOUR', daily(at('14:00')), NOW)), 60);
  assert.equal(
    minutesBetween(stopDeadline('TWO_HOURS', daily(at('14:00')), NOW)),
    120,
  );
});

test('«до конца дня» ведёт до закрытия по расписанию, а не до полуночи', () => {
  // 14:00, закрытие в 22:00 — восемь часов
  const until = stopDeadline('END_OF_DAY', daily(at('14:00')), NOW);
  assert.equal(minutesBetween(until), 8 * 60);
});

test('после закрытия «до конца дня» переносится на следующую смену', () => {
  // 23:00: до конца дня уже нечего держать, ведём до открытия в 10:00
  const until = stopDeadline('END_OF_DAY', daily(at('23:00')), NOW);
  assert.equal(minutesBetween(until), 11 * 60);
});

test('«до следующей смены» — открытие завтра, а не ровно сутки', () => {
  const until = stopDeadline('NEXT_SHIFT', daily(at('14:00')), NOW);
  // от 14:00 до 10:00 завтра — 20 часов
  assert.equal(minutesBetween(until), 20 * 60);
});

test('выходной пропускается: смена ищется дальше по календарю', () => {
  const schedule: ScheduleLookup = {
    nowMinutes: at('14:00'),
    // завтра выходной, послезавтра работаем с 11:00
    hoursOn: (day) => (day === 1 ? [] : [['11:00', '22:00']]),
  };
  const until = stopDeadline('NEXT_SHIFT', schedule, NOW);
  // 34 часа: 10 до полуночи + 24 + 11 … считаем точно
  assert.equal(minutesBetween(until), 2 * 24 * 60 - at('14:00') + at('11:00'));
});

test('без расписания «до конца дня» держит до полуночи', () => {
  const schedule: ScheduleLookup = { nowMinutes: at('14:00'), hoursOn: () => [] };
  const until = stopDeadline('END_OF_DAY', schedule, NOW);
  assert.equal(minutesBetween(until), 10 * 60);
});

test('несколько интервалов за день: держим до последнего закрытия', () => {
  const schedule: ScheduleLookup = {
    nowMinutes: at('12:00'),
    hoursOn: () => [
      ['10:00', '14:00'],
      ['17:00', '23:00'],
    ],
  };
  const until = stopDeadline('END_OF_DAY', schedule, NOW);
  assert.equal(minutesBetween(until), 11 * 60);
});
