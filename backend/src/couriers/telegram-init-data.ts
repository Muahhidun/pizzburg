import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подписи Telegram Mini App (initData).
 *
 * Telegram подписывает данные запуска токеном бота: подделать их, не зная
 * токена, нельзя. Поэтому курьеру не нужен ни логин, ни пароль — его
 * личность и есть подписанный Telegram id.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

/** Данные старше суток не принимаем: ссылку запуска могли подсмотреть */
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): InitDataUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSec - authDate > INIT_DATA_MAX_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get('user') ?? 'null') as InitDataUser | null;
    return user && typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Подпись для тестов: так initData собирает сам Telegram */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
