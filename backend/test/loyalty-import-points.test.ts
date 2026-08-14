import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maskPhone,
  parseBirthday,
  parsePoints,
} from '../prisma/import-loyalty-balances';

test('дробные балансы округляются вверх — клиент не теряет баллы', () => {
  assert.equal(parsePoints('224,11'), 225);
  assert.equal(parsePoints('1712,10'), 1713);
  assert.equal(parsePoints('0,01'), 1);
  assert.equal(parsePoints('86,70'), 87);
});

test('целые значения не меняются', () => {
  assert.equal(parsePoints('500'), 500);
  assert.equal(parsePoints('153'), 153);
  assert.equal(parsePoints('0'), 0);
});

test('прочерк и пустое значение — нулевой баланс', () => {
  assert.equal(parsePoints('—'), 0);
  assert.equal(parsePoints(''), 0);
  assert.equal(parsePoints('-'), 0);
});

test('пробелы-разделители разрядов не ломают разбор', () => {
  assert.equal(parsePoints('5 792,60'), 5793);
  // неразрывный пробел, как в выгрузке FoodPicasso
  assert.equal(parsePoints('1 000'), 1000);
});

test('мусор и отрицательные значения отклоняются', () => {
  assert.throws(() => parsePoints('abc'), /вне диапазона/);
  assert.throws(() => parsePoints('-5'), /вне диапазона/);
  assert.throws(() => parsePoints('99999999'), /вне диапазона/);
});

test('дата рождения разбирается в UTC-полночь без сдвига на сутки', () => {
  const date = parseBirthday('08.09.1990');
  assert.equal(date?.toISOString(), '1990-09-08T00:00:00.000Z');
  // граница месяца — самое место, где часовой пояс уводит дату назад
  assert.equal(parseBirthday('01.01.2000')?.toISOString(), '2000-01-01T00:00:00.000Z');
});

test('пустая дата рождения означает «не указана», а не ошибку', () => {
  assert.equal(parseBirthday(''), undefined);
  assert.equal(parseBirthday('—'), undefined);
  assert.equal(parseBirthday(undefined), undefined);
});

test('несуществующие и кривые даты отклоняются', () => {
  assert.throws(() => parseBirthday('31.02.1990'), /не существует/);
  assert.throws(() => parseBirthday('1990-09-08'), /ДД\.ММ\.ГГГГ/);
});

test('телефон в логах маскируется', () => {
  assert.equal(maskPhone('+77071234567'), '+7707****567');
  assert.equal(maskPhone('+7'), '***');
});
