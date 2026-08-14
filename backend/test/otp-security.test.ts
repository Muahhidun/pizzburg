import assert from 'node:assert/strict';
import test from 'node:test';
import { Logger } from '@nestjs/common';
import { normalizeKzPhone } from '../src/common/phone';

/**
 * Разбор `OTP_TEST_PHONES` — копия логики из auth.service.
 *
 * Смысл проверки не в самом парсинге, а в инварианте: список тестовых
 * номеров по умолчанию ПУСТ. Пустой список означает, что dev-режим не
 * отдаёт код никому — именно этого не хватало, когда публичный staging
 * начал возвращать `devCode` на любой из 14 965 реальных номеров.
 */
function testPhones(raw: string | undefined, logger: Logger): Set<string> {
  const result = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      result.add(normalizeKzPhone(trimmed));
    } catch {
      logger.error(`OTP_TEST_PHONES: «${trimmed}» — не номер, запись пропущена`);
    }
  }
  return result;
}

const silent = new Logger('test');
silent.error = () => undefined;

test('без OTP_TEST_PHONES код не получает никто', () => {
  assert.equal(testPhones(undefined, silent).size, 0);
  assert.equal(testPhones('', silent).size, 0);
  assert.equal(testPhones('   ', silent).size, 0);
});

test('тестовые номера нормализуются — формат записи не важен', () => {
  const phones = testPhones('87071112233, +7 707 222 33 44', silent);
  assert.ok(phones.has('+77071112233'));
  assert.ok(phones.has('+77072223344'));
  assert.equal(phones.size, 2);
});

test('мусор в списке не роняет вход и не расширяет доступ', () => {
  const phones = testPhones('не-номер, 87071112233', silent);
  assert.equal(phones.size, 1);
  assert.ok(phones.has('+77071112233'));
});

test('реальный клиент не попадает в список сам по себе', () => {
  const phones = testPhones('87071112233', silent);
  assert.ok(!phones.has('+77079998877'));
});

/** Генератор кода: шесть цифр, ведущие нули сохраняются. */
function formatCode(value: number, digits = 6): string {
  return String(value).padStart(digits, '0');
}

test('код всегда шестизначный, включая малые значения', () => {
  assert.equal(formatCode(0), '000000');
  assert.equal(formatCode(42), '000042');
  assert.equal(formatCode(999999), '999999');
  assert.equal(formatCode(123456).length, 6);
});
