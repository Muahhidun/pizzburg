import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Logger } from '@nestjs/common';
import {
  AuthService,
  TELEGRAM_AUTO_FALLBACK_MS,
  TELEGRAM_MANUAL_FALLBACK_MS,
} from '../src/auth/auth.service';

Logger.overrideLogger(false);

/**
 * Вход через Telegram с запасной SMS (DECISIONS §12.40).
 *
 * Главное здесь — инварианты: старые сборки получают только SMS; в
 * Telegram и в SMS уходит один и тот же код; запасная SMS уходит ровно
 * один раз и только если Telegram не доставил.
 */
function setup(opts: { telegram?: 'ok' | 'none'; delivered?: boolean } = {}) {
  const codes: { phone: string; code: string; createdAt: Date }[] = [];
  const prisma = {
    otpCode: {
      findFirst: async ({ where }: any) =>
        codes.find(
          (c) => c.phone === where.phone && c.createdAt > where.createdAt.gt,
        ) ?? null,
      count: async () => codes.length,
      create: async ({ data }: any) => {
        codes.push({ ...data, createdAt: new Date() });
      },
    },
  };
  const sms: { phone: string; code: string }[] = [];
  const smsService = {
    configured: true,
    sendOtp: async (phone: string, code: string) => {
      sms.push({ phone, code });
    },
  };
  const tg: { phone: string; code: string }[] = [];
  const telegram = {
    configured: opts.telegram !== undefined,
    sendCode: async (phone: string, code: string) => {
      if (opts.telegram !== 'ok') return null;
      tg.push({ phone, code });
      return 'req-1';
    },
    delivered: async () => opts.delivered ?? true,
    reportValid: () => undefined,
  };
  const auth = new AuthService(
    prisma as any,
    {} as any,
    smsService as any,
    telegram as any,
  );
  return { auth, sms, tg, codes };
}

const PHONE = '87071112233';
const tick = () => new Promise((r) => setImmediate(r));

test('старая сборка без channel получает только SMS', async () => {
  const { auth, sms, tg } = setup({ telegram: 'ok' });
  const res = await auth.requestOtp(PHONE);
  assert.equal(res.channel, 'sms');
  assert.equal(sms.length, 1);
  assert.equal(tg.length, 0);
});

test('auto: есть Telegram — код уходит туда, SMS нет', async () => {
  const { auth, sms, tg } = setup({ telegram: 'ok' });
  const res = await auth.requestOtp(PHONE, 'auto');
  assert.equal(res.channel, 'telegram');
  assert.equal(tg.length, 1);
  assert.equal(sms.length, 0);
});

test('auto: у номера нет Telegram — сразу SMS, без ожидания', async () => {
  const { auth, sms } = setup({ telegram: 'none' });
  const res = await auth.requestOtp(PHONE, 'auto');
  assert.equal(res.channel, 'sms');
  assert.equal(sms.length, 1);
});

test('auto: Telegram не настроен — SMS', async () => {
  const { auth, sms } = setup();
  const res = await auth.requestOtp(PHONE, 'auto');
  assert.equal(res.channel, 'sms');
  assert.equal(sms.length, 1);
});

test('Telegram не доставил за 15 секунд — тот же код уходит SMS сам', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { auth, sms, tg } = setup({ telegram: 'ok', delivered: false });
    await auth.requestOtp(PHONE, 'auto');
    mock.timers.tick(TELEGRAM_AUTO_FALLBACK_MS);
    await tick();
    await tick();
    assert.equal(sms.length, 1);
    assert.equal(sms[0].code, tg[0].code);
  } finally {
    mock.timers.reset();
  }
});

test('Telegram доставил — запасной SMS нет', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { auth, sms } = setup({ telegram: 'ok', delivered: true });
    await auth.requestOtp(PHONE, 'auto');
    mock.timers.tick(TELEGRAM_AUTO_FALLBACK_MS);
    await tick();
    await tick();
    assert.equal(sms.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('кнопка «по SMS»: рано — отказ, позже — тот же код и без минутного кулдауна', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { auth, sms, tg, codes } = setup({ telegram: 'ok', delivered: true });
    await auth.requestOtp(PHONE, 'auto');

    await assert.rejects(auth.requestOtp(PHONE, 'sms'), /Telegram/);

    mock.timers.tick(TELEGRAM_MANUAL_FALLBACK_MS);
    const res = await auth.requestOtp(PHONE, 'sms');
    assert.equal(res.channel, 'sms');
    assert.equal(sms.length, 1);
    assert.equal(sms[0].code, tg[0].code);
    assert.equal(codes.length, 1, 'новый код не создаётся');

    // Повторное нажатие не шлёт вторую SMS
    await auth.requestOtp(PHONE, 'sms');
    assert.equal(sms.length, 1);
  } finally {
    mock.timers.reset();
  }
});
