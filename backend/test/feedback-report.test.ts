import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewBreakdown } from '../src/orders/feedback-report';

/**
 * Сводка по отзывам (DECISIONS §12.23).
 *
 * Смысл сводки — показать, что чинить. Проверяем именно это: что доля
 * худших ответов считается по вопросу, а не тонет в средней оценке.
 */

test('пустой период не делает вид, что всё на пятёрку', () => {
  const r = reviewBreakdown([]);
  assert.equal(r.total, 0);
  assert.equal(r.averageRating, 0);
  assert.deepEqual(r.questions, []);
});

test('вопросы без ответов не показываются', () => {
  // Самовывоз: про курьера не спрашивали
  const r = reviewBreakdown([
    { rating: 5, answers: { taste: 'GREAT', timing: 'ON_TIME' } },
  ]);
  const ids = r.questions.map((q) => q.id);
  assert.deepEqual(ids.sort(), ['taste', 'timing']);
});

test('доля худших видна, даже когда средняя высокая', () => {
  // Девять довольных и один, которому сильно опоздали
  const rows = [
    ...Array.from({ length: 9 }, () => ({
      rating: 5,
      answers: { timing: 'ON_TIME' },
    })),
    { rating: 4, answers: { timing: 'VERY_LATE' } },
  ];
  const r = reviewBreakdown(rows);

  assert.equal(r.averageRating, 4.9);
  const timing = r.questions.find((q) => q.id === 'timing')!;
  assert.equal(timing.answered, 10);
  assert.equal(timing.worstPct, 10);
});

test('считаем каждый вариант, а не только худший', () => {
  const r = reviewBreakdown([
    { rating: 3, answers: { temperature: 'COLD' } },
    { rating: 3, answers: { temperature: 'WARM' } },
    { rating: 5, answers: { temperature: 'HOT' } },
  ]);
  const temp = r.questions.find((q) => q.id === 'temperature')!;
  assert.deepEqual(
    temp.options.map((o) => [o.label, o.count, o.worst]),
    [
      ['Холодная', 1, true],
      ['Тёплая', 1, false],
      ['Горячая', 1, false],
    ],
  );
});

test('средняя округляется до десятых, а не прячет разброс', () => {
  const r = reviewBreakdown([
    { rating: 5, answers: { taste: 'GREAT' } },
    { rating: 4, answers: { taste: 'GOOD' } },
    { rating: 1, answers: { taste: 'BAD' } },
  ]);
  assert.equal(r.averageRating, 3.3);
});
