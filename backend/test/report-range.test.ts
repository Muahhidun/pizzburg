import assert from 'node:assert/strict';
import test from 'node:test';
import { reportRange } from '../src/admin/admin.service';

/**
 * Границы периода отчёта.
 *
 * Проверяем ровно ту ошибку, из-за которой отчёт врал молча: выбранный
 * конечный день должен попадать в выборку, а не отсекаться.
 */

test('конечный день входит в период целиком', () => {
  const { to } = reportRange('2026-08-01', '2026-08-14');
  // граница исключающая (lt), поэтому она равна началу СЛЕДУЮЩЕГО дня
  assert.equal(to.getDate(), 15);
  assert.equal(to.getHours(), 0);
  assert.equal(to.getMinutes(), 0);
});

test('отмена в конце выбранного дня попадает в отчёт', () => {
  const { from, to } = reportRange('2026-08-14', '2026-08-14');
  const lateCancel = new Date(2026, 7, 14, 23, 59, 0);

  assert.ok(lateCancel >= from, 'должна быть не раньше начала периода');
  assert.ok(lateCancel < to, 'должна попадать внутрь периода');
});

test('период начинается с полуночи начального дня', () => {
  const { from } = reportRange('2026-08-01', '2026-08-14');
  assert.equal(from.getDate(), 1);
  assert.equal(from.getHours(), 0);
});

test('без дат берётся последний месяц', () => {
  const { from, to } = reportRange();
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(days - 30) < 0.01, `ожидали 30 дней, вышло ${days}`);
});

test('полная метка времени принимается как есть', () => {
  const { to } = reportRange(undefined, '2026-08-14T12:30:00.000Z');
  assert.equal(to.toISOString(), '2026-08-14T12:30:00.000Z');
});
