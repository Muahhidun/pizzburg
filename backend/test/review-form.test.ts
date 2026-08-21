import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_QUESTIONS,
  questionsFor,
  scoreReview,
} from '../src/orders/review-form';

/**
 * Анкета о заказе (DECISIONS §12.23).
 *
 * Смысл шкал в том, что оценку считаем мы, а человек отвечает на факты.
 * Здесь проверяем именно арифметику и правило «хуже некуда».
 */

test('у самовывоза не спрашивают про курьера', () => {
  const pickup = questionsFor('PICKUP').map((q) => q.id);
  const delivery = questionsFor('DELIVERY').map((q) => q.id);

  assert.ok(!pickup.includes('courier'));
  assert.ok(delivery.includes('courier'));
  assert.equal(delivery.length, pickup.length + 1);
});

test('варианты идут от худшего к лучшему', () => {
  for (const question of REVIEW_QUESTIONS) {
    const weights = question.options.map((o) => o.weight);
    assert.deepEqual(
      weights,
      [...weights].sort((a, b) => a - b),
      `порядок сбит в «${question.label}»`,
    );
  }
});

test('всё хорошо — пятёрка и смену не будим', () => {
  const { rating, hasWorst } = scoreReview(
    {
      timing: 'ON_TIME',
      complete: 'FULL',
      temperature: 'HOT',
      taste: 'GREAT',
      courier: 'POLITE',
    },
    'DELIVERY',
  );
  assert.equal(rating, 5);
  assert.equal(hasWorst, false);
});

test('забытая позиция поднимает смену даже при хорошей средней', () => {
  const { rating, hasWorst } = scoreReview(
    {
      timing: 'ON_TIME',
      complete: 'MISSING',
      temperature: 'HOT',
      taste: 'GREAT',
      courier: 'POLITE',
    },
    'DELIVERY',
  );
  // Среднее высокое — а соус всё равно надо привезти
  assert.ok(rating >= 4, `оценка ${rating}`);
  assert.equal(hasWorst, true);
});

test('пропущенные вопросы не занижают оценку', () => {
  const full = scoreReview({ taste: 'GREAT' }, 'PICKUP');
  assert.equal(full.rating, 5);
  assert.equal(full.hasWorst, false);
  // Один ответ — одна строка для чата, а не пять пустых
  assert.equal(full.lines.length, 1);
});

test('пустая анкета даёт нулевую оценку, а не единицу', () => {
  assert.equal(scoreReview({}, 'PICKUP').rating, 0);
});

test('подделанный вариант ответа игнорируется', () => {
  const { rating, lines } = scoreReview(
    { taste: 'PERFECT_10', temperature: 'HOT' },
    'PICKUP',
  );
  assert.equal(lines.length, 1);
  assert.equal(rating, 5);
});

test('ответы попадают в сообщение словами, а не кодами', () => {
  const { lines } = scoreReview(
    { timing: 'VERY_LATE', complete: 'FULL' },
    'PICKUP',
  );
  assert.deepEqual(lines, [
    'Успели вовремя? — Сильно опоздали',
    'Всё привезли? — Да, всё на месте',
  ]);
});
