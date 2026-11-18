import assert from 'node:assert/strict';
import test from 'node:test';
import { linkOrderNumbers, telegramMessageUrl } from '../src/telegram/telegram.service';

/**
 * Номера заказов в Телеграме — ссылками на заказ в админке.
 * Номер чека Poster — другой номер, его ссылкой делать нельзя.
 */
const base = 'https://admin.example';
const link = (n: number) => `<a href="${base}/orders?n=${n}">№${n}</a>`;

test('номера заказов становятся ссылками', () => {
  assert.equal(
    linkOrderNumbers('Клиент оформил №116, а у него уже есть заказы №114, №115.', base),
    `Клиент оформил ${link(116)}, а у него уже есть заказы ${link(114)}, ${link(115)}.`,
  );
  assert.equal(
    linkOrderNumbers('✉️ <b>Заказ №116 — Где мой заказ?</b>', base),
    `✉️ <b>Заказ ${link(116)} — Где мой заказ?</b>`,
  );
});

test('номер чека Poster не трогаем', () => {
  for (const t of [
    'Отклоните чек №105509 на планшете.',
    'ОТКЛОНИТЕ ЧЕК №105509, НЕ ГОТОВЬТЕ.',
    'Чек №105509 приняли до ответа клиента',
    'Служебный чек №55 → Кухня',
  ]) {
    assert.equal(linkOrderNumbers(t, base), t);
  }
  assert.equal(
    linkOrderNumbers('ЗАКАЗ №113 ОТМЕНЁН. ОТКЛОНИТЕ ЧЕК №105509', base),
    `ЗАКАЗ ${link(113)} ОТМЕНЁН. ОТКЛОНИТЕ ЧЕК №105509`,
  );
});

test('без адреса админки и в готовых ссылках — без изменений', () => {
  assert.equal(linkOrderNumbers('Заказ №1', ''), 'Заказ №1');
  const done = `${link(7)} и №8`;
  assert.equal(linkOrderNumbers(done, base), `${link(7)} и ${link(8)}`);
});

test('номер ведёт на сообщение о заказе в группе кассиров, если оно есть', () => {
  const url = telegramMessageUrl('-1001234567890', 77);
  assert.equal(url, 'https://t.me/c/1234567890/77');
  assert.equal(
    linkOrderNumbers('Клиент оформил №119, а у него уже есть заказ №118.', base, (n) =>
      n === 118 ? url : null,
    ),
    `Клиент оформил ${link(119)}, а у него уже есть заказ <a href="${url}">№118</a>.`,
  );
});

test('у обычной группы внутренних ссылок нет', () => {
  assert.equal(telegramMessageUrl('-4001234', 5), null);
  assert.equal(telegramMessageUrl(null, 5), null);
  assert.equal(telegramMessageUrl('-1001', null), null);
});
