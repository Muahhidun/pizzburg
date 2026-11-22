import assert from 'node:assert/strict';
import test from 'node:test';
import { questionsFor, scoreReview } from '../src/orders/review-form';

test('самовывоз: свои формулировки, без курьера', () => {
  const labels = questionsFor('PICKUP').map((q) => q.label);
  assert.deepEqual(labels, [
    'Заказ был готов вовремя?',
    'Всё было на месте?',
    'Еда была горячей?',
    'Вкус',
  ]);
  assert.equal(questionsFor('DELIVERY')[1].label, 'Всё привезли?');
  const r = scoreReview({ complete: 'MISSING' }, 'PICKUP');
  assert.deepEqual(r.lines, ['Всё было на месте? — Кое-чего не было']);
});
