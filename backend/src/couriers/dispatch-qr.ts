import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QR «Я на месте» на планшете раздачи (docs/COURIER_SYSTEM_SPEC.md §5).
 *
 * Код меняется каждые 10 секунд и подписан сервером, поэтому фото кода,
 * пересланное другу, через 10–20 секунд уже не сработает. Принимаем текущее и
 * предыдущее окно: курьер мог навести камеру на границе смены кода.
 *
 * Формат: `PZQ1.<venueId>.<окно>.<подпись>`. Состояния в базе нет:
 * проверка — только пересчёт подписи.
 */

export const QR_WINDOW_MS = 10_000;
const PREFIX = 'PZQ1';

function secret(): string {
  // Отдельная переменная не нужна: ключ выводится из JWT_SECRET, и его
  // смена при инциденте заодно отзывает все старые QR.
  const base = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod';
  return createHmac('sha256', base).update('courier-qr').digest('base64url');
}

function sign(venueId: string, window: number): string {
  return createHmac('sha256', secret())
    .update(`${venueId}.${window}`)
    .digest('base64url')
    .slice(0, 22);
}

export function createQrToken(venueId: string, nowMs = Date.now()) {
  const window = Math.floor(nowMs / QR_WINDOW_MS);
  return {
    token: `${PREFIX}.${venueId}.${window}.${sign(venueId, window)}`,
    /** Сколько ещё живёт этот код на экране, мс */
    refreshInMs: (window + 1) * QR_WINDOW_MS - nowMs,
  };
}

/** venueId из действующего кода или null */
export function verifyQrToken(token: string, nowMs = Date.now()): string | null {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, venueId, windowRaw, signature] = parts;
  const window = Number(windowRaw);
  if (!Number.isInteger(window)) return null;

  const current = Math.floor(nowMs / QR_WINDOW_MS);
  if (window !== current && window !== current - 1) return null;

  const expected = Buffer.from(sign(venueId, window));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return venueId;
}
