/**
 * Заказы из устаревших версий приложения (Дом, 28.11.2026).
 *
 * С 1.0.1 приложение само закрывается экраном «Обновите приложение», когда
 * его версия ниже минимальной из настроек. У 1.0.0 такой проверки нет, и
 * заставить её обновиться можно только здесь: оформление заказа — первое
 * место, где старое приложение показывает текст ошибки сервера как есть.
 *
 * Версию приложение присылает заголовком `X-App-Version` (с 1.0.2). Без
 * заголовка — это 1.0.0 или 1.0.1, и считаем такую версию самой старой.
 * Платформу старые версии тоже не сообщают, поэтому для них берём больший
 * из двух минимумов: отказ получат все, кому пора обновиться.
 *
 * Сайт не трогаем: он всегда свежий, а `X-Client: web` ставит с 21.11.
 * Минимальные версии не заданы — проверка выключена.
 */

const VERSION = /^\d+\.\d+\.\d+$/;

export function isOlderVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.split('+')[0].split('.').map((p) => Number(p) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const l = x[i] ?? 0;
    const r = y[i] ?? 0;
    if (l !== r) return l < r;
  }
  return false;
}

export function appVersionRefusal(
  settings: unknown,
  client: { web: boolean; version?: string | null; platform?: string | null; lang?: string | null },
): string | null {
  if (client.web) return null;
  const update = (((settings ?? {}) as Record<string, unknown>).appUpdate ?? {}) as Record<string, unknown>;
  const valid = (v: unknown) => (typeof v === 'string' && VERSION.test(v.trim()) ? v.trim() : null);
  const ios = valid(update.minIos);
  const android = valid(update.minAndroid);
  const platform = client.platform?.toLowerCase();
  const min =
    platform === 'ios'
      ? ios
      : platform === 'android'
        ? android
        : [ios, android].filter((v): v is string => !!v).sort((a, b) => (isOlderVersion(a, b) ? 1 : -1))[0] ?? null;
  if (!min) return null;
  const version = valid(client.version) ?? '0.0.0';
  if (!isOlderVersion(version, min)) return null;
  return client.lang?.toLowerCase().startsWith('kk')
    ? 'Қолданбаның бұл нұсқасы ескірген, онда тапсырыс қабылдамаймыз. PizzBurg-ті App Store немесе Google Play-де жаңартыңыз — ұпайлар мен тапсырыстар тарихы сақталады.'
    : 'Эта версия приложения устарела, заказы в ней больше не принимаем. Обновите PizzBurg в App Store или Google Play — баллы и история заказов сохранятся.';
}
