/**
 * Поиск по адресному справочнику города.
 *
 * Логика вынесена из сервиса отдельным чистым модулем: это единственное
 * место, где решается, найдёт ли человек свой дом, и его нужно проверять
 * тестами, а не на живых клиентах.
 */

export interface AddressEntry {
  street: string;
  house: string;
  lat?: number | null;
  lng?: number | null;
}

/// Слова-типы улиц. В справочнике они есть («улица Абая»), а человек их
/// почти никогда не печатает — выкидываем с обеих сторон, чтобы «абая»
/// находило «улицу Абая», а «улица абая» не считалось другим запросом.
const STREET_TYPES = new Set([
  'улица',
  'ул',
  'проспект',
  'пр',
  'пр-т',
  'переулок',
  'пер',
  'бульвар',
  'б-р',
  'шоссе',
  'микрорайон',
  'мкр',
  'мкрн',
  'квартал',
  'проезд',
  'тупик',
  'площадь',
  'пл',
  'köşe',
  'көше',
  'даңғылы',
  'дангылы',
  'шағын',
  'ауданы',
]);

/// Казахская кириллица к русской. Клиент печатает «Конаева», а в OSM
/// улица записана как «Дінмұхамед Қонаев» — без этого он свой дом не найдёт.
const KZ_TO_RU: Record<string, string> = {
  ә: 'а',
  ғ: 'г',
  қ: 'к',
  ң: 'н',
  ө: 'о',
  ұ: 'у',
  ү: 'у',
  һ: 'х',
  і: 'и',
  ё: 'е',
};

/** Приводит строку к виду, в котором её можно сравнивать с запросом */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[әғқңөұүһіё]/g, (ch) => KZ_TO_RU[ch] ?? ch)
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

/** Значимые слова названия: без типа улицы и без пустых */
export function streetTokens(street: string): string[] {
  return normalize(street)
    .split(' ')
    .filter((w) => w && !STREET_TYPES.has(w));
}

/**
 * Ключ улицы: название без типа и без написания.
 *
 * В OSM одна и та же улица записана по-разному — «улица Бухар Жырау» (168
 * домов) и «Бухар Жырау» (12). Для человека это одна улица, и две строки в
 * подсказках он прочитает как ошибку. Сравниваем и группируем по ключу,
 * а показываем самое распространённое написание.
 */
export function streetKey(street: string): string {
  return streetTokens(street).join(' ');
}

/**
 * Совпадает ли слово запроса со словом названия.
 *
 * Обычный префикс покрывает «берким» → «Беркимбаева». Обратный префикс
 * нужен для склонений: человек печатает «конаева», а в справочнике стоит
 * «Қонаев» — запрос длиннее хранимого слова. Ограничение в 4 символа
 * не даёт «а» совпасть с чем угодно.
 */
function wordMatches(token: string, word: string): boolean {
  if (word.startsWith(token)) return true;
  return token.length >= 4 && token.startsWith(word) && word.length >= 4;
}

const isNumberToken = (token: string) => /^\d/.test(token);

export interface ParsedQuery {
  words: string[];
  house: string | null;
}

/** Разбирает «абая 38а» на слова названия и номер дома */
export function parseQuery(query: string): ParsedQuery {
  const tokens = normalize(query)
    .split(' ')
    .filter((t) => t && !STREET_TYPES.has(t));

  // Дом — только **последний** числовой кусок и только если перед ним что-то
  // есть. Иначе «207 квартал» превратится в дом без улицы и не найдётся
  // вовсе, а в «12-я линейная 5» домом станет «12».
  const last = tokens[tokens.length - 1];
  const hasHouse = tokens.length > 1 && last !== undefined && isNumberToken(last);
  return {
    words: hasHouse ? tokens.slice(0, -1) : tokens,
    house: hasHouse ? last : null,
  };
}

function streetMatches(words: string[], tokens: string[]): boolean {
  return words.every((word) => tokens.some((t) => wordMatches(word, t)));
}

/**
 * Насколько хорошо название подошло: меньше — лучше.
 *
 * Совпадение с начала названия ценнее совпадения с середины: человек,
 * набравший «бух», ищет «Бухар Жырау», а не «улицу Мухтара Ауэзова».
 */
function streetScore(words: string[], tokens: string[]): number {
  let score = 0;
  for (const word of words) {
    const index = tokens.findIndex((t) => wordMatches(word, t));
    score += index * 10;
    score += Math.max(0, tokens[index].length - word.length);
  }
  return score + tokens.length;
}

/// Самое распространённое написание в группе: по нему стоит больше домов,
/// значит именно его и считают правильным те, кто размечал город.
function canonical(names: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [name, count] of names) {
    if (count > bestCount || (count === bestCount && name.length > best.length)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Улицы по запросу. Пока номер дома не введён, показывать дома
 * бессмысленно: на улице Беркимбаева их 217, и первые восемь не значат
 * ничего.
 */
export function searchStreets(
  entries: AddressEntry[],
  query: string,
  limit = 8,
): string[] {
  const { words } = parseQuery(query);
  if (words.length === 0) return [];

  const best = new Map<
    string,
    { score: number; names: Map<string, number> }
  >();
  for (const entry of entries) {
    const tokens = streetTokens(entry.street);
    if (!streetMatches(words, tokens)) continue;
    const key = tokens.join(' ');
    const score = streetScore(words, tokens);
    const group = best.get(key) ?? { score, names: new Map() };
    group.score = Math.min(group.score, score);
    group.names.set(entry.street, (group.names.get(entry.street) ?? 0) + 1);
    best.set(key, group);
  }

  return [...best.values()]
    .sort(
      (a, b) => a.score - b.score || canonical(a.names).localeCompare(canonical(b.names), 'ru'),
    )
    .slice(0, limit)
    .map((group) => canonical(group.names));
}

/** Дома на конкретной улице, отсортированные по-человечески: 2, 10, 10А */
export function searchHouses(
  entries: AddressEntry[],
  street: string,
  query = '',
  limit = 30,
): AddressEntry[] {
  const target = streetKey(street);
  const prefix = normalize(query).replace(/\s+/g, '');

  return entries
    .filter(
      (e) =>
        streetKey(e.street) === target &&
        (!prefix || normalize(e.house).replace(/\s+/g, '').startsWith(prefix)),
    )
    .sort((a, b) => a.house.localeCompare(b.house, 'ru', { numeric: true }))
    .slice(0, limit);
}

/**
 * Полные адреса — когда человек ввёл и улицу, и номер одной строкой.
 * Используется подсказками в приложении: «абая 38» должно сразу давать
 * готовый адрес, а не заставлять выбирать улицу и печатать дом заново.
 */
export function searchAddresses(
  entries: AddressEntry[],
  query: string,
  limit = 8,
): AddressEntry[] {
  const { words, house } = parseQuery(query);
  if (words.length === 0 || !house) return [];

  return entries
    .map((entry) => {
      const tokens = streetTokens(entry.street);
      if (!streetMatches(words, tokens)) return null;
      const normalizedHouse = normalize(entry.house).replace(/\s+/g, '');
      if (!normalizedHouse.startsWith(house)) return null;
      return {
        entry,
        score:
          streetScore(words, tokens) + (normalizedHouse.length - house.length),
      };
    })
    .filter((x): x is { entry: AddressEntry; score: number } => x !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.entry.house.localeCompare(b.entry.house, 'ru', { numeric: true }),
    )
    .slice(0, limit)
    .map((x) => x.entry);
}

/** Есть ли такой адрес в справочнике — проверка перед оформлением заказа */
export function findExact(
  entries: AddressEntry[],
  street: string,
  house: string,
): AddressEntry | null {
  const s = streetKey(street);
  const h = normalize(house).replace(/\s+/g, '');
  return (
    entries.find(
      (e) =>
        streetKey(e.street) === s &&
        normalize(e.house).replace(/\s+/g, '') === h,
    ) ?? null
  );
}
