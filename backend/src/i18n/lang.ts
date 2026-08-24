/**
 * Язык клиента (DECISIONS §12.30).
 *
 * Приложение сообщает его заголовком `Accept-Language` на каждом
 * запросе, а не хранит в профиле: язык — свойство телефона, и человек
 * с двумя устройствами имеет право читать на разных.
 */
export type Lang = 'ru' | 'kk';

export function langFrom(header?: string | string[]): Lang {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.toLowerCase().trimStart().startsWith('kk') ? 'kk' : 'ru';
}

/** Пустой перевод — отдаём русское, а не пустую строку. */
export function pick(lang: Lang, ru: string, kk?: string | null): string {
  return lang === 'kk' && kk && kk.trim().length > 0 ? kk : ru;
}
