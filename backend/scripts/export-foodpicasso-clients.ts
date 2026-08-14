import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

type Client = {
  id: number;
  name?: string | null;
  phone?: string | null;
  bdate?: string | null;
  visit?: string | null;
  lastOrder?: string | null;
  lastOrderTimestamp?: number | null;
  dateRegistered?: string | null;
  cart?: number | null;
  points?: string | number | null;
  sex?: string | number | null;
  platform?: string | null;
  isExistDeviceToken?: boolean | null;
  receipt?: string | number | null;
  isBlacklist?: boolean | null;
  cups?: string | number | null;
  [key: string]: unknown;
};

type ParsedCurl = {
  url: string;
  headers: Map<string, string>;
  body: JsonRecord;
};

type Options = {
  curlFile: string;
  outputRoot: string;
  maxPages?: number;
  delayMs: number;
};

/// Пауза между страницами: 150 запросов подряд без пауз выглядят как
/// атака и могут упереться в rate limit чужой системы.
const DEFAULT_DELAY_MS = 400;
/// Сколько раз повторить страницу при сетевой ошибке или 5xx
const MAX_RETRIES = 3;
/// Как часто сбрасывать промежуточный результат на диск
const CHECKPOINT_EVERY = 20;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const CHECKSUM_ALPHABET = 'abcdefghijklmnopqrstuvwxyp0123456789';
const CSV_COLUMNS = [
  'id',
  'name',
  'phone',
  'bdate',
  'visit',
  'lastOrder',
  'lastOrderTimestamp',
  'dateRegistered',
  'cart',
  'points',
  'sex',
  'platform',
  'isExistDeviceToken',
  'receipt',
  'isBlacklist',
  'cups',
] as const;

function usage(): string {
  return [
    'FoodPicasso customer exporter',
    '',
    'Usage:',
    '  npm run foodpicasso:export -- --curl /tmp/foodpicasso-getByParams.curl',
    '',
    'Options:',
    '  --curl FILE       File containing Safari “Copy as cURL” output (required)',
    '  --out DIR         Output root (default: ../private/foodpicasso)',
    '  --max-pages N     Stop after N pages for a safe test',
    `  --delay MS        Pause between pages (default: ${DEFAULT_DELAY_MS})`,
    '  --help            Show this help',
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  let curlFile = '';
  let outputRoot = path.resolve(process.cwd(), '../private/foodpicasso');
  let maxPages: number | undefined;
  let delayMs = DEFAULT_DELAY_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--curl') {
      curlFile = argv[++i] ?? '';
      continue;
    }
    if (arg === '--out') {
      outputRoot = path.resolve(argv[++i] ?? '');
      continue;
    }
    if (arg === '--max-pages') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--max-pages must be a positive integer');
      }
      maxPages = value;
      continue;
    }
    if (arg === '--delay') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('--delay must be a non-negative integer');
      }
      delayMs = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!curlFile) {
    throw new Error('--curl is required');
  }

  return { curlFile: path.resolve(curlFile), outputRoot, maxPages, delayMs };
}

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let active = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (escaped) {
      if (char !== '\n' && char !== '\r') {
        token += char;
        active = true;
      }
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      active = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      active = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (active) {
        tokens.push(token);
        token = '';
        active = false;
      }
      continue;
    }

    token += char;
    active = true;
  }

  if (escaped) token += '\\';
  if (quote) throw new Error('Unclosed quote in cURL text');
  if (active) tokens.push(token);
  return tokens;
}

function parseCurl(source: string): ParsedCurl {
  const tokens = shellTokens(source);
  const curlIndex = tokens.findIndex((token) => token === 'curl' || token.endsWith('/curl'));
  if (curlIndex === -1) throw new Error('The file does not contain a cURL command');

  let url = '';
  let rawBody = '';
  const headers = new Map<string, string>();

  for (let i = curlIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '-H' || token === '--header') {
      const rawHeader = tokens[++i] ?? '';
      const separator = rawHeader.indexOf(':');
      if (separator > 0) {
        headers.set(
          rawHeader.slice(0, separator).trim().toLowerCase(),
          rawHeader.slice(separator + 1).trim(),
        );
      }
      continue;
    }
    if (token === '--data-raw' || token === '--data' || token === '--data-binary' || token === '-d') {
      rawBody = tokens[++i] ?? '';
      continue;
    }
    if (token === '-X' || token === '--request' || token === '-A' || token === '--user-agent') {
      i += 1;
      continue;
    }
    if (!token.startsWith('-') && /^https?:\/\//i.test(token)) {
      url = token;
    }
  }

  if (!url) throw new Error('Could not find request URL in cURL command');
  if (!rawBody) throw new Error('Could not find JSON request body in cURL command');

  let body: JsonRecord;
  try {
    body = JSON.parse(rawBody) as JsonRecord;
  } catch {
    throw new Error('The cURL request body is not valid JSON');
  }

  return { url, headers, body };
}

function checksum(data: unknown): number {
  const points = new Map<string, number>();
  [...CHECKSUM_ALPHABET].forEach((letter, index) => points.set(letter, index + 1));
  let sum = 0;
  for (const letter of JSON.stringify(data).toLowerCase()) {
    sum += points.get(letter) ?? 0;
  }
  return sum;
}

function requestHeaders(source: Map<string, string>, body: JsonRecord): Record<string, string> {
  const allowed = ['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'referer', 'user-agent'];
  const headers: Record<string, string> = {};
  for (const key of allowed) {
    const value = source.get(key);
    if (value) headers[key] = value;
  }
  if (!headers.cookie) throw new Error('The cURL request does not contain the authenticated Cookie header');
  headers['content-type'] ||= 'text/plain;charset=UTF-8';
  headers.accept ||= '*/*';
  headers.checksum = String(checksum(body));
  return headers;
}

function pageBody(template: JsonRecord, page: number): JsonRecord {
  const body = structuredClone(template);
  const params = body.params as JsonRecord | undefined;
  if (!params) throw new Error('Request body is missing params');
  params.page = page;
  params.perPage = 100;
  params.client = null;

  const filters = params.filters as JsonRecord | undefined;
  const user = filters?.user as JsonRecord | undefined;
  if (user) user.ids = [];
  params.fastList = true;
  params.skipFilterDictionary = true;
  return body;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clientsCsv(clients: Client[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const client of clients) {
    rows.push(CSV_COLUMNS.map((column) => csvCell(client[column])).join(','));
  }
  return `${rows.join('\n')}\n`;
}

function timestampFolderName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/// Одна попытка. Сетевые сбои и 5xx повторяются в fetchPage.
async function fetchPageOnce(parsed: ParsedCurl, page: number): Promise<JsonRecord> {
  const body = pageBody(parsed.body, page);
  const response = await fetch(parsed.url, {
    method: 'POST',
    headers: requestHeaders(parsed.headers, body),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // 401/403 — истекла cookie, повторять бессмысленно
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `FoodPicasso вернул HTTP ${response.status} на странице ${page}: сессия истекла. ` +
          'Перезайдите в админку, заново скопируйте cURL и запустите экспорт снова.',
      );
    }
    throw new Error(`FoodPicasso returned HTTP ${response.status} on page ${page}`);
  }
  const payload = (await response.json()) as JsonRecord;
  if (payload.success !== true) {
    throw new Error(`FoodPicasso returned success=false on page ${page}`);
  }
  if (!Array.isArray(payload.clients)) {
    throw new Error(`FoodPicasso response has no clients array on page ${page}`);
  }
  return payload;
}

/// Повтор с нарастающей паузой. Сессионные ошибки не повторяем —
/// они пробрасываются сразу.
async function fetchPage(parsed: ParsedCurl, page: number): Promise<JsonRecord> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fetchPageOnce(parsed, page);
    } catch (error) {
      if (error instanceof Error && error.message.includes('сессия истекла')) throw error;
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const backoff = 1000 * attempt;
        console.warn(
          `  ⚠ страница ${page}, попытка ${attempt}/${MAX_RETRIES} не удалась: ` +
            `${error instanceof Error ? error.message : error}. Повтор через ${backoff} мс`,
        );
        await sleep(backoff);
      }
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const curlText = await readFile(options.curlFile, 'utf8');
  const parsed = parseCurl(curlText);

  if (!/\/client\/getByParams(?:\?|$)/.test(parsed.url)) {
    throw new Error('Expected a /client/getByParams cURL request');
  }

  console.log('Checking authorization and reading page 1…');
  const first = await fetchPage(parsed, 1);
  const advertisedPages = Math.max(1, Number(first.pagination) || 1);
  const pageLimit = Math.min(advertisedPages, options.maxPages ?? advertisedPages);
  const clientsById = new Map<number, Client>();

  const consume = (payload: JsonRecord): void => {
    for (const rawClient of payload.clients as Client[]) {
      if (Number.isInteger(rawClient.id)) clientsById.set(rawClient.id, rawClient);
    }
  };
  consume(first);
  console.log(`Page 1/${pageLimit}: ${clientsById.size} unique records`);

  // Каталог создаём сразу: при обрыве на середине уже выгруженное
  // останется на диске, а не потеряется.
  const outputDir = path.join(options.outputRoot, timestampFolderName());
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const snapshot = async (): Promise<void> => {
    const partial = [...clientsById.values()].sort((a, b) => a.id - b.id);
    await writeFile(
      path.join(outputDir, 'clients-rich.json'),
      `${JSON.stringify(partial, null, 2)}\n`,
      { mode: 0o600 },
    );
  };

  let lastPage = 1;
  try {
    for (let page = 2; page <= pageLimit; page += 1) {
      if (options.delayMs > 0) await sleep(options.delayMs);
      const payload = await fetchPage(parsed, page);
      consume(payload);
      lastPage = page;
      console.log(`Page ${page}/${pageLimit}: ${clientsById.size} unique records`);
      if (page % CHECKPOINT_EVERY === 0) {
        await snapshot();
        console.log(`  ✓ промежуточное сохранение (${clientsById.size} записей)`);
      }
    }
  } catch (error) {
    // Сохраняем то, что успели, и говорим, с какой страницы продолжать
    await snapshot();
    console.error(
      `\nЭкспорт прерван на странице ${lastPage + 1}. ` +
        `Сохранено ${clientsById.size} записей в ${outputDir}`,
    );
    throw error;
  }

  const clients = [...clientsById.values()].sort((a, b) => a.id - b.id);

  const summary = {
    exportedAt: new Date().toISOString(),
    endpoint: new URL(parsed.url).origin + new URL(parsed.url).pathname,
    company: (parsed.body.meta as JsonRecord | undefined)?.company ?? null,
    advertisedClients: first.countClients ?? null,
    advertisedPages,
    exportedPages: pageLimit,
    exportedUniqueClients: clients.length,
    note: 'Phone numbers may be null in getByParams and must be joined later by FoodPicasso client id.',
  };

  await Promise.all([
    writeFile(path.join(outputDir, 'clients-rich.json'), `${JSON.stringify(clients, null, 2)}\n`, { mode: 0o600 }),
    writeFile(path.join(outputDir, 'clients-rich.csv'), clientsCsv(clients), { mode: 0o600 }),
    writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 }),
  ]);

  console.log(`Done: ${clients.length} unique customer profiles`);
  console.log(`Saved locally: ${outputDir}`);
  console.log('The export directory is ignored by Git. The cURL file is not copied or logged.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Export failed: ${message}`);
  process.exitCode = 1;
});
