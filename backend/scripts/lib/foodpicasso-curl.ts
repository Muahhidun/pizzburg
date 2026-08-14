/**
 * Разбор Safari «Copy as cURL» и подпись запросов FoodPicasso.
 * Общий код для экспортёров профилей и телефонов.
 *
 * ВАЖНО: cURL содержит живую сессионную cookie. Файл не копируем,
 * не логируем и не коммитим.
 */

export type JsonRecord = Record<string, unknown>;

export type ParsedCurl = {
  url: string;
  headers: Map<string, string>;
  body: JsonRecord;
};

const CHECKSUM_ALPHABET = 'abcdefghijklmnopqrstuvwxyp0123456789';

export function shellTokens(source: string): string[] {
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

export function parseCurl(source: string): ParsedCurl {
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

export function checksum(data: unknown): number {
  const points = new Map<string, number>();
  [...CHECKSUM_ALPHABET].forEach((letter, index) => points.set(letter, index + 1));
  let sum = 0;
  for (const letter of JSON.stringify(data).toLowerCase()) {
    sum += points.get(letter) ?? 0;
  }
  return sum;
}

export function requestHeaders(source: Map<string, string>, body: JsonRecord): Record<string, string> {
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
