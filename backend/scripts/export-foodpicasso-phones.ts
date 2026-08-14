import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  JsonRecord,
  ParsedCurl,
  parseCurl,
  requestHeaders,
} from './lib/foodpicasso-curl';

/**
 * Второй этап миграции: телефоны клиентов FoodPicasso.
 *
 * `/client/getByParams` отдаёт профили и баллы, но телефон прячет у всех,
 * кто не заказывал последнюю неделю (в выгрузке телефон есть лишь у ~3%).
 * `/client/suggest` ищет по подстроке номера и возвращает пары
 * `{id, name}`, где name — сам телефон. Внутренний id совпадает с id
 * профиля, поэтому данные соединяются точно, без склейки по имени.
 *
 * Выдача ограничена 50 записями на запрос, поэтому перебор адаптивный:
 * запрос углубляется, только если упёрся в лимит. Углубляем и приписыванием
 * цифры справа, и слева — иначе потеряются номера, заканчивающиеся
 * на текущую подстроку.
 *
 * Использование:
 *   npm run foodpicasso:phones -- --curl /tmp/foodpicasso-suggest.curl \
 *     --clients ../private/foodpicasso/<папка>/clients-rich.json
 */

const SUGGEST_LIMIT = 50;
const DEFAULT_DELAY_MS = 300;
const MAX_RETRIES = 3;
const CHECKPOINT_EVERY = 200;
/** Предохранитель от бесконечного перебора */
const DEFAULT_MAX_QUERIES = 60_000;

type Options = {
  curlFile: string;
  clientsFile: string;
  outputRoot: string;
  delayMs: number;
  maxQueries: number;
};

type SuggestItem = { id: number; name?: string | null };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function usage(): string {
  return [
    'FoodPicasso phone exporter',
    '',
    'Usage:',
    '  npm run foodpicasso:phones -- --curl /tmp/foodpicasso-suggest.curl \\',
    '    --clients ../private/foodpicasso/<folder>/clients-rich.json',
    '',
    'Options:',
    '  --curl FILE       Safari “Copy as cURL” для /client/suggest (обязателен)',
    '  --clients FILE    clients-rich.json из первого экспорта (обязателен)',
    '  --out DIR         Куда сложить результат (по умолчанию рядом с clients)',
    `  --delay MS        Пауза между запросами (по умолчанию ${DEFAULT_DELAY_MS})`,
    `  --max-queries N   Предохранитель (по умолчанию ${DEFAULT_MAX_QUERIES})`,
    '  --help            Показать эту справку',
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  let curlFile = '';
  let clientsFile = '';
  let outputRoot = '';
  let delayMs = DEFAULT_DELAY_MS;
  let maxQueries = DEFAULT_MAX_QUERIES;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--curl') { curlFile = argv[++i] ?? ''; continue; }
    if (arg === '--clients') { clientsFile = argv[++i] ?? ''; continue; }
    if (arg === '--out') { outputRoot = argv[++i] ?? ''; continue; }
    if (arg === '--delay') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) throw new Error('--delay must be >= 0');
      delayMs = v;
      continue;
    }
    if (arg === '--max-queries') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error('--max-queries must be >= 1');
      maxQueries = v;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!curlFile) throw new Error('--curl is required');
  if (!clientsFile) throw new Error('--clients is required');

  const clients = path.resolve(clientsFile);
  return {
    curlFile: path.resolve(curlFile),
    clientsFile: clients,
    outputRoot: outputRoot ? path.resolve(outputRoot) : path.dirname(clients),
    delayMs,
    maxQueries,
  };
}

/** Номер к виду +7XXXXXXXXXX; мусор отбрасываем */
export function normalizeKzPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return null;
}

async function suggestOnce(parsed: ParsedCurl, q: string): Promise<SuggestItem[]> {
  const body = structuredClone(parsed.body) as JsonRecord;
  const params = (body.params ?? {}) as JsonRecord;
  params.q = q;
  body.params = params;

  const res = await fetch(parsed.url, {
    method: 'POST',
    headers: requestHeaders(parsed.headers, body),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `HTTP ${res.status}: сессия истекла. Перезайдите в админку, ` +
          'заново скопируйте cURL запроса suggest и запустите снова.',
      );
    }
    throw new Error(`HTTP ${res.status} на запросе "${q}"`);
  }
  const json = (await res.json()) as { success?: boolean; result?: SuggestItem[] };
  if (json.success !== true) throw new Error(`success=false на запросе "${q}"`);
  return json.result ?? [];
}

async function suggest(parsed: ParsedCurl, q: string): Promise<SuggestItem[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await suggestOnce(parsed, q);
    } catch (error) {
      if (error instanceof Error && error.message.includes('сессия истекла')) throw error;
      lastError = error;
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const parsed = parseCurl(await readFile(options.curlFile, 'utf8'));
  if (!/\/client\/suggest(?:\?|$)/.test(parsed.url)) {
    throw new Error('Ожидается cURL запроса /client/suggest');
  }

  const clients = JSON.parse(
    await readFile(options.clientsFile, 'utf8'),
  ) as { id: number; phone?: string | null }[];
  const wantedIds = new Set(clients.map((c) => c.id));
  console.log(`Профилей в выгрузке: ${wantedIds.size}`);

  // Телефоны, которые getByParams всё-таки отдал
  const phoneById = new Map<number, string>();
  for (const c of clients) {
    const normalized = normalizeKzPhone(c.phone);
    if (normalized) phoneById.set(c.id, normalized);
  }
  console.log(`Уже известно телефонов: ${phoneById.size}`);

  const outputDir = path.join(
    options.outputRoot,
    `phones-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const snapshot = async (): Promise<void> => {
    const rows = [...phoneById.entries()].map(([id, phone]) => ({ id, phone }));
    await writeFile(
      path.join(outputDir, 'phones.json'),
      `${JSON.stringify(rows, null, 2)}\n`,
      { mode: 0o600 },
    );
  };

  // Адаптивный обход: углубляем только насыщенные запросы
  const queue: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const visited = new Set<string>(queue);
  let processed = 0;
  let saturated = 0;

  try {
    while (queue.length > 0 && processed < options.maxQueries) {
      const q = queue.shift()!;
      if (options.delayMs > 0 && processed > 0) await sleep(options.delayMs);

      const items = await suggest(parsed, q);
      processed += 1;

      for (const item of items) {
        const phone = normalizeKzPhone(item.name);
        if (phone && Number.isInteger(item.id)) phoneById.set(item.id, phone);
      }

      // Упёрлись в лимит — за ним могут прятаться ещё номера
      if (items.length >= SUGGEST_LIMIT) {
        saturated += 1;
        for (const digit of '0123456789') {
          // вправо — для номеров, где подстрока не в конце
          const right = q + digit;
          // влево — иначе потеряем номера, заканчивающиеся на q
          const left = digit + q;
          for (const next of [right, left]) {
            if (!visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
          }
        }
      }

      if (processed % 25 === 0) {
        const covered = [...wantedIds].filter((id) => phoneById.has(id)).length;
        const pct = ((covered / wantedIds.size) * 100).toFixed(1);
        console.log(
          `запросов ${processed} (в очереди ${queue.length}) · ` +
            `телефонов ${phoneById.size} · покрыто ${covered}/${wantedIds.size} (${pct}%)`,
        );
        // Все профили нашлись — продолжать перебор незачем
        if (covered === wantedIds.size) {
          console.log('Все профили покрыты, останавливаемся досрочно.');
          break;
        }
      }
      if (processed % CHECKPOINT_EVERY === 0) await snapshot();
    }
  } catch (error) {
    await snapshot();
    console.error(`\nПрервано после ${processed} запросов. Сохранено в ${outputDir}`);
    throw error;
  }

  // Соединяем профили с телефонами по внутреннему id
  const merged = clients.map((c) => ({
    ...c,
    phoneNormalized: phoneById.get(c.id) ?? null,
  }));
  const covered = merged.filter((c) => c.phoneNormalized).length;
  const uniquePhones = new Set(merged.map((c) => c.phoneNormalized).filter(Boolean));

  const summary = {
    exportedAt: new Date().toISOString(),
    clientsFile: options.clientsFile,
    profiles: clients.length,
    queriesSent: processed,
    saturatedQueries: saturated,
    queueLeft: queue.length,
    phonesFound: phoneById.size,
    profilesWithPhone: covered,
    profilesWithoutPhone: clients.length - covered,
    uniquePhones: uniquePhones.size,
    duplicatePhones: covered - uniquePhones.size,
    hitMaxQueries: processed >= options.maxQueries,
  };

  await snapshot();
  await Promise.all([
    writeFile(
      path.join(outputDir, 'clients-merged.json'),
      `${JSON.stringify(merged, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(outputDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(outputDir, 'clients-merged.csv'),
      [
        'id,phone,name,points,bdate,cart,platform,isBlacklist',
        ...merged.map((c: any) =>
          [
            c.id,
            c.phoneNormalized ?? '',
            JSON.stringify(c.name ?? ''),
            JSON.stringify(String(c.points ?? '')),
            c.bdate && c.bdate !== '—' ? c.bdate : '',
            c.cart ?? '',
            c.platform ?? '',
            c.isBlacklist ? 'true' : 'false',
          ].join(','),
        ),
      ].join('\n') + '\n',
      { mode: 0o600 },
    ),
  ]);

  console.log('\n=== ИТОГ ===');
  console.log(`запросов отправлено: ${processed} (насыщенных: ${saturated})`);
  console.log(`профилей с телефоном: ${covered} из ${clients.length}`);
  console.log(`без телефона осталось: ${clients.length - covered}`);
  if (summary.duplicatePhones > 0) {
    console.log(`⚠ повторяющихся номеров: ${summary.duplicatePhones} (один телефон у нескольких профилей)`);
  }
  if (summary.hitMaxQueries) {
    console.log('⚠ достигнут предел --max-queries, перебор не завершён');
  }
  console.log(`\nСохранено: ${outputDir}`);
  console.log('Каталог в .gitignore. Файл cURL не копируется и не логируется.');
}

main().catch((error) => {
  console.error(`Export failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
