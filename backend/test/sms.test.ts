import assert from 'node:assert/strict';
import test from 'node:test';
import { SmsService } from '../src/sms/sms.service';

/**
 * Отправка SMS (DECISIONS §12.25).
 *
 * Каждое сообщение стоит денег, поэтому проверяем ровно то, где ошибка
 * дорога: формат номера, признак настроенности и распознавание отказа
 * провайдера — «отправилось» при code=5 означало бы, что человек ждёт
 * код, которого не будет.
 */
function withFetch(reply: unknown, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    return {
      ok: status < 400,
      status,
      json: async () => reply,
    } as Response;
  }) as never;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('без ключа сервис честно говорит, что не настроен', () => {
  delete process.env.MOBIZON_API_KEY;
  assert.equal(new SmsService().configured, false);

  process.env.MOBIZON_API_KEY = 'kz-test';
  assert.equal(new SmsService().configured, true);
});

test('номер уходит без плюса и прочих знаков', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  delete process.env.MOBIZON_FROM;
  const { calls, restore } = withFetch({ code: 0, data: {}, message: '' });
  try {
    await new SmsService().sendOtp('+7 (707) 127-27-89', '123456');
  } finally {
    restore();
  }

  assert.match(calls[0].url, /api\.mobizon\.kz\/service\/message\/sendsmsmessage$/);
  assert.equal(calls[0].body.get('recipient'), '77071272789');
  assert.match(calls[0].body.get('text') ?? '', /123456/);
  // Имя отправителя не задано — не шлём пустое поле, общее имя даст сам
  // провайдер
  assert.equal(calls[0].body.has('from'), false);
});

test('код входит в одну SMS: кириллица — 70 символов', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  const { calls, restore } = withFetch({ code: 0 });
  try {
    await new SmsService().sendOtp('+77071272789', '123456');
  } finally {
    restore();
  }
  const text = calls[0].body.get('text') ?? '';
  assert.ok(text.length <= 70, `длина ${text.length}: платим за две SMS`);
});

test('отказ провайдера не выдаётся за успех', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  const { restore } = withFetch({ code: 5, message: 'Недостаточно средств' });
  try {
    await assert.rejects(
      () => new SmsService().sendOtp('+77071272789', '123456'),
      /code=5/,
    );
  } finally {
    restore();
  }
});

test('фоновая отправка считается принятой', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  const { restore } = withFetch({ code: 100 });
  try {
    await new SmsService().sendOtp('+77071272789', '123456');
  } finally {
    restore();
  }
});

test('ошибка HTTP не проходит молча', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  const { restore } = withFetch({}, 502);
  try {
    await assert.rejects(
      () => new SmsService().sendOtp('+77071272789', '123456'),
      /502/,
    );
  } finally {
    restore();
  }
});

test('заданное имя отправителя уходит в запрос', async () => {
  process.env.MOBIZON_API_KEY = 'kz-test';
  process.env.MOBIZON_FROM = 'PizzBurg';
  const { calls, restore } = withFetch({ code: 0 });
  try {
    await new SmsService().sendOtp('+77071272789', '123456');
  } finally {
    restore();
    delete process.env.MOBIZON_FROM;
  }
  assert.equal(calls[0].body.get('from'), 'PizzBurg');
});
