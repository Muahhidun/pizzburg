import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePosterProducts } from '../src/orders/orders.service';

// №357, 27.11.2026: «Донер маленький ×4» и «×1 (подарок)» двумя строками —
// Poster отклонил чек целиком: products cannot be duplicated.
test('одинаковая позиция и подарок такой же — одной строкой', () => {
  assert.deepEqual(
    mergePosterProducts([
      { product_id: 101, count: 4 },
      { product_id: 202, count: 1 },
      { product_id: 101, count: 1 },
    ]),
    [
      { product_id: 101, count: 5 },
      { product_id: 202, count: 1 },
    ],
  );
});

test('та же позиция с разными модификаторами остаётся отдельно', () => {
  const mods = JSON.stringify([{ m: 7, a: 1 }]);
  assert.deepEqual(
    mergePosterProducts([
      { product_id: 101, count: 2, modification: mods },
      { product_id: 101, count: 1 },
    ]),
    [
      { product_id: 101, count: 2, modification: mods },
      { product_id: 101, count: 1 },
    ],
  );
});
