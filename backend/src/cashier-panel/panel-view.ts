import type { InlineButton } from '../telegram/telegram.service';

/**
 * Пульт кассы в Телеграме — тексты и кнопки, без сервисов.
 *
 * Данные кнопок: `p:<шаг>[:<аргумент>…]`, Телеграм даёт 64 байта; id
 * товара и категории — cuid в 25 знаков.
 */

/** Кнопки у поля ввода (значок с квадратиками). Текст — он же команда */
export const KEY = {
  panel: '🎛 Пульт',
  ordering: '🛑 Приём заказов',
  rush: '🔥 Высокий спрос',
  stops: '📋 Стоп-лист',
} as const;

export const replyKeyboard = {
  keyboard: [[{ text: KEY.ordering }, { text: KEY.rush }], [{ text: KEY.stops }, { text: KEY.panel }]],
  resize_keyboard: true,
  is_persistent: false,
};

/** Сроки стопа для кассира: бессрочных нет — их ставят на витрине */
export const STOP_CHOICES = [
  { code: 'H', preset: 'HOUR', label: 'На 1 час' },
  { code: 'T', preset: 'TWO_HOURS', label: 'На 2 часа' },
  { code: 'E', preset: 'END_OF_DAY', label: 'До конца дня' },
] as const;

export const ORDERING_MINUTES = [30, 60, 120] as const;
export const RUSH_CHOICES = [20, 40, 60] as const;

const close: InlineButton = { text: '✖ Закрыть', callback_data: 'p:close' };

export interface PanelState {
  mode: 'ALL' | 'PICKUP_ONLY' | 'CLOSED';
  orderingUntil: string | null;
  rushExtraMinutes: number;
  rushUntil: string | null;
  stops: Array<{ name: string; until: Date | string }>;
}

export function hhmm(at: Date | string, tz: string) {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function orderingLine(s: PanelState, tz: string) {
  const until = s.orderingUntil ? ` до ${hhmm(s.orderingUntil, tz)}` : '';
  if (s.mode === 'CLOSED') return `🛑 <b>Приём заказов остановлен</b>${until}`;
  if (s.mode === 'PICKUP_ONLY') return `🚗 <b>Доставка остановлена</b>${until}, только самовывоз`;
  return '🟢 Приём заказов: открыт';
}

export function panelText(s: PanelState, tz: string): string {
  const lines = ['🎛 <b>Пульт кассы</b>', '', orderingLine(s, tz)];
  lines.push(
    s.rushExtraMinutes > 0 && s.rushUntil
      ? `🔥 <b>Высокий спрос: +${s.rushExtraMinutes} мин</b> до ${hhmm(s.rushUntil, tz)}`
      : '🟢 Спрос: обычный',
  );
  if (s.stops.length === 0) {
    lines.push('🟢 Стоп-лист: пусто');
  } else {
    lines.push(`⛔️ <b>На стопе: ${s.stops.length}</b>`);
    for (const st of s.stops.slice(0, 15)) lines.push(`   • ${esc(st.name)} — до ${hhmm(st.until, tz)}`);
    if (s.stops.length > 15) lines.push(`   … и ещё ${s.stops.length - 15}`);
  }
  return lines.join('\n');
}

export function panelKeyboard(): InlineButton[][] {
  return [
    [
      { text: KEY.ordering, callback_data: 'p:o' },
      { text: KEY.rush, callback_data: 'p:r' },
    ],
    [{ text: KEY.stops, callback_data: 'p:s' }],
  ];
}

export function orderingMenu(s: PanelState, tz: string) {
  const rows: InlineButton[][] = [];
  if (s.mode !== 'ALL') rows.push([{ text: '▶️ Возобновить приём', callback_data: 'p:oa' }]);
  const label = (m: number) => (m < 60 ? `${m} мин` : `${m / 60} ч`);
  rows.push(
    ORDERING_MINUTES.map((m, i) => ({
      text: `${i === 0 ? '🚗 Доставку ' : ''}${label(m)}`,
      callback_data: `p:op:${m}`,
    })),
    ORDERING_MINUTES.map((m, i) => ({
      text: `${i === 0 ? '🛑 Всё ' : ''}${label(m)}`,
      callback_data: `p:oc:${m}`,
    })),
    [close],
  );
  return {
    text:
      `${orderingLine(s, tz)}\n\n` +
      '🚗 <b>Доставку</b> — остановить доставку, самовывоз остаётся.\n' +
      '🛑 <b>Всё</b> — не принимать никаких заказов.\n' +
      'Выберите, на сколько. Приём вернётся сам.',
    keyboard: rows,
  };
}

export function rushMenu(s: PanelState, tz: string) {
  const rows: InlineButton[][] = [
    RUSH_CHOICES.map((m) => ({ text: `+${m} мин`, callback_data: `p:rs:${m}` })),
  ];
  if (s.rushExtraMinutes > 0) rows.push([{ text: '🔻 Снять', callback_data: 'p:rs:0' }]);
  rows.push([close]);
  const now =
    s.rushExtraMinutes > 0 && s.rushUntil
      ? `Сейчас: +${s.rushExtraMinutes} мин до ${hhmm(s.rushUntil, tz)}`
      : 'Сейчас: обычный срок';
  return {
    text:
      `🔥 <b>Высокий спрос</b>\n${now}\n\n` +
      'Клиентам добавится время к сроку доставки. Держится 1 час и снимается само.',
    keyboard: rows,
  };
}

export interface StopRow {
  id: string;
  name: string;
  until: Date | string;
  kind: 'product' | 'category';
}

/** Главное меню стоп-листа: что на стопе (с «вернуть») и категории */
export function stopsMenu(
  stopped: StopRow[],
  categories: Array<{ id: string; name: string }>,
  tz: string,
) {
  const rows: InlineButton[][] = stopped.slice(0, 20).map((s) => [
    {
      text: `↩️ Вернуть: ${s.name}`,
      callback_data: `p:${s.kind === 'category' ? 'uc' : 'up'}:${s.id}`,
    },
  ]);
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2).map((c) => ({ text: c.name, callback_data: `p:sc:${c.id}:0` })));
  }
  rows.push([close]);
  const head = stopped.length
    ? `⛔️ <b>На стопе:</b>\n${stopped
        .map((s) => `• ${esc(s.name)} — до ${hhmm(s.until, tz)}`)
        .join('\n')}\n\n`
    : '';
  return {
    text: `📋 <b>Стоп-лист</b>\n\n${head}Выберите категорию. Или напишите в группу «стоп» и название, например «стоп пепперони».`,
    keyboard: rows,
  };
}

export const PAGE = 16;

export function categoryMenu(
  category: { id: string; name: string },
  products: Array<{ id: string; name: string; stopped: boolean }>,
  page: number,
) {
  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = products.slice(p * PAGE, p * PAGE + PAGE);
  const rows: InlineButton[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    rows.push(
      slice.slice(i, i + 2).map((it) => ({
        text: `${it.stopped ? '⛔️ ' : ''}${it.name}`,
        callback_data: `p:sp:${it.id}`,
      })),
    );
  }
  if (pages > 1) {
    const nav: InlineButton[] = [];
    if (p > 0) nav.push({ text: '◂ Ещё', callback_data: `p:sc:${category.id}:${p - 1}` });
    if (p < pages - 1) nav.push({ text: 'Ещё ▸', callback_data: `p:sc:${category.id}:${p + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: '⛔️ Вся категория', callback_data: `p:sk:${category.id}` }]);
  rows.push([{ text: '◂ Назад', callback_data: 'p:s' }, close]);
  return {
    text: `📋 <b>${esc(category.name)}</b>${pages > 1 ? ` (${p + 1}/${pages})` : ''}\nЧто поставить на стоп?`,
    keyboard: rows,
  };
}

/** Выбор срока. `kind` p — товар, k — категория */
export function durationMenu(kind: 'p' | 'k', id: string, name: string, back: string) {
  return {
    text: `⛔️ <b>${esc(name)}</b>\nНа сколько поставить на стоп?`,
    keyboard: [
      STOP_CHOICES.map((c) => ({ text: c.label, callback_data: `p:${kind}y:${id}:${c.code}` })),
      [{ text: '◂ Назад', callback_data: back }, close],
    ] as InlineButton[][],
  };
}

export function searchResults(query: string, found: Array<{ id: string; name: string }>) {
  if (found.length === 0) {
    return {
      text: `🔎 «${esc(query)}» — ничего не нашлось. Откройте стоп-лист и выберите по категории.`,
      keyboard: [[{ text: KEY.stops, callback_data: 'p:s' }, close]] as InlineButton[][],
    };
  }
  return {
    text: `🔎 «${esc(query)}» — что поставить на стоп?`,
    keyboard: [
      ...found.map((f) => [{ text: f.name, callback_data: `p:sp:${f.id}` }]),
      [close],
    ] as InlineButton[][],
  };
}

// ─── Поиск товара по тексту кассира ──────────────────────────────

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Расстояние Левенштейна, с ранним выходом: нам важно только «≤ max» */
function within(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Насколько слово запроса похоже на слово названия: 3 — начало слова,
 * 2 — с одной опечаткой («баланьез» ~ «болоньезе»), 0 — не похоже.
 */
function wordScore(q: string, w: string) {
  if (w.startsWith(q)) return 3;
  if (q.length >= 4) {
    const head = w.slice(0, q.length);
    const typos = q.length >= 7 ? 2 : 1;
    if (within(q, head, typos) || within(q, w, typos)) return 2;
  }
  return 0;
}

/**
 * Ищем по смыслу набора слов, а не по точному тексту: порядок слов не
 * важен («грибы курица» найдёт «Курица с грибами»), хватает начала слова
 * («пепп»), прощается опечатка в длинном слове. Каждое слово запроса
 * должно найтись в названии.
 */
export function searchProducts<T extends { name: string }>(query: string, items: T[], limit = 6): T[] {
  const qs = normalize(query).split(' ').filter(Boolean);
  if (qs.length === 0) return [];
  const scored: Array<{ it: T; score: number }> = [];
  for (const it of items) {
    const words = normalize(it.name).split(' ').filter(Boolean);
    let total = 0;
    let ok = true;
    for (const q of qs) {
      const best = Math.max(0, ...words.map((w) => wordScore(q, w)));
      if (best === 0) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) scored.push({ it, score: total * 100 - words.length });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.it);
}

/** «стоп пепперони», «Стоп: кола 1 л» → «пепперони»; иначе null */
export function stopQuery(text: string): string | null {
  const m = /^\s*стоп[\s:,-]+(.+)$/iu.exec(text);
  return m ? m[1].trim() : null;
}
