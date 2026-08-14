import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { normalizeKzPhone } from '../src/common/phone';

/**
 * Безопасный импорт балансов СТАРОГО ПРИЛОЖЕНИЯ (не бонусов Poster).
 *
 * CSV: phone,points,name (также понимает ;, tab и русские заголовки).
 * Дополнительные колонки id и bdate используются, если они есть.
 * По умолчанию только строит план; запись — лишь с --apply.
 * Повтор того же --batch пропускается по метке в журнале.
 *
 * npx tsx prisma/import-loyalty-balances.ts balances.csv
 * npx tsx prisma/import-loyalty-balances.ts balances.csv --apply --batch=legacy-2026-08
 *
 * Флаги:
 *   --apply            выполнить запись (без него — только план)
 *   --tenant=<slug>    арендатор, по умолчанию pizzburg
 *   --batch=<метка>    метка идемпотентности, обязательна при --apply
 *   --report=<dir>     куда сложить отчёт; по умолчанию рядом с CSV
 *   --sample=<n>       сколько строк вынести в выборку для ручной сверки
 *   --no-birthday      НЕ переносить дату рождения (по умолчанию переносим)
 */

const prisma = new PrismaClient();

/** Размер пачки для чтения (IN-списки) и для записи (createMany). */
const CHUNK = 1000;
const WRITE_CHUNK = 500;

/**
 * Баланс старого приложения → целые баллы.
 *
 * FoodPicasso хранит дробные балансы («224,11» — русский разделитель,
 * таких примерно 6 700 из 15 000). Наши баллы целые, 1 балл = 1 ₸.
 * Округляем ВВЕРХ по решению владельца: разница на всю базу около
 * 3 400 ₸, зато ни один клиент не теряет ни балла при переходе.
 * Прочерк «—» и пустое значение означают нулевой баланс.
 */
export function parsePoints(raw: string): number {
  const cleaned = String(raw).replace(/\s| /g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '—' || cleaned === '-') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new Error(`баланс «${raw}» вне диапазона 0…10 000 000`);
  }
  return Math.ceil(value);
}

/**
 * Дата рождения FoodPicasso («08.09.1990») → Date в UTC-полночь.
 *
 * Пустое значение и «—» означают «не указана». Час не важен, но полночь
 * именно UTC: иначе дата в поясе арендатора уедет на сутки назад.
 */
export function parseBirthday(raw: string | undefined): Date | undefined {
  const value = String(raw ?? '').trim();
  if (value === '' || value === '—' || value === '-') return undefined;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) throw new Error(`дата рождения «${raw}» не в формате ДД.ММ.ГГГГ`);
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`дата рождения «${raw}» не существует`);
  }
  return date;
}

/** Телефон для логов и отчётов: +7707****123 — узнаваемо, но не выгрузка базы. */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return `${phone.slice(0, 5)}****${phone.slice(-3)}`;
}

function parseLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function findColumn(headers: string[], candidates: string[]) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return normalized.findIndex((header) => candidates.includes(header));
}

function csvCell(value: unknown) {
  return JSON.stringify(String(value ?? ''));
}

/** Хост и имя БД без пароля — чтобы в отчёте было видно, куда шёл прогон. */
function describeDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) return 'DATABASE_URL не задан';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return 'нераспознанный DATABASE_URL';
  }
}

type Row = {
  row: number;
  legacyId: string;
  phone: string;
  points: number;
  name?: string;
  birthday?: Date;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) throw new Error('Укажите путь к CSV-файлу');

  const apply = args.includes('--apply');
  // Даты рождения переносим по умолчанию (решение владельца 13.08.2026).
  // Иначе легко потерять их навсегда: прогон без флага пометит клиентов
  // меткой batch, и повтор с флагом будет пропущен как уже импортированный.
  const withBirthday = !args.includes('--no-birthday');
  const tenantSlug =
    args.find((arg) => arg.startsWith('--tenant='))?.slice(9) || 'pizzburg';
  const batchArg = args.find((arg) => arg.startsWith('--batch='))?.slice(8);
  const batch = batchArg || basename(file);
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(batch)) {
    throw new Error('Некорректный --batch: используйте буквы, цифры, точку, _ или -');
  }
  // Метка идемпотентности — единственная защита от повторного начисления.
  // Позволить ей молча стать именем файла при боевом прогоне слишком дорого.
  if (apply && !batchArg) {
    throw new Error('С --apply обязателен явный --batch=<метка>');
  }
  const sampleSize = Number(
    args.find((arg) => arg.startsWith('--sample='))?.slice(9) || 30,
  );

  const csvPath = resolve(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = resolve(
    args.find((arg) => arg.startsWith('--report='))?.slice(9) ||
      join(dirname(csvPath), `import-${apply ? 'apply' : 'plan'}-${stamp}`),
  );

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error(`Тенант «${tenantSlug}» не найден`);

  console.log(`Режим:      ${apply ? 'ЗАПИСЬ (--apply)' : 'план, без записи'}`);
  console.log(`База:       ${describeDatabase()}`);
  console.log(`Арендатор:  ${tenantSlug} (${tenant.id})`);
  console.log(`Файл:       ${csvPath}`);
  console.log(`Метка:      ${batch}`);
  console.log(`Дни рожд.:  ${withBirthday ? 'переносим' : 'НЕ переносим (--no-birthday)'}`);

  const text = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV пуст или не содержит строк данных');
  const delimiter = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(';')
      ? ';'
      : ',';
  const headers = parseLine(lines[0], delimiter);
  const phoneIndex = findColumn(headers, ['phone', 'телефон', 'номер']);
  const pointsIndex = findColumn(headers, [
    'points',
    'balance',
    'баланс',
    'баллы',
    'бонусы',
  ]);
  const nameIndex = findColumn(headers, ['name', 'имя', 'клиент']);
  const idIndex = findColumn(headers, ['id', 'legacyid']);
  const birthdayIndex = findColumn(headers, ['bdate', 'birthday', 'др', 'дата рождения']);
  if (phoneIndex < 0 || pointsIndex < 0) {
    throw new Error('Нужны колонки phone/телефон и points/balance/баланс');
  }

  const rows: Row[] = [];
  const invalid: Array<{ row: number; legacyId: string; reason: string }> = [];
  let birthdaysParsed = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i], delimiter);
    const legacyId = idIndex >= 0 ? cells[idIndex] || '' : '';
    try {
      const phone = normalizeKzPhone(cells[phoneIndex] ?? '');
      const points = parsePoints(cells[pointsIndex] ?? '');
      const birthday =
        birthdayIndex >= 0 ? parseBirthday(cells[birthdayIndex]) : undefined;
      if (birthday) birthdaysParsed++;
      rows.push({
        row: i + 1,
        legacyId,
        phone,
        points,
        name: nameIndex >= 0 ? cells[nameIndex] || undefined : undefined,
        birthday,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Пустой телефон — типовой случай (брошенные регистрации), и он не
      // должен теряться среди прочих ошибок разбора.
      const reason =
        (cells[phoneIndex] ?? '').trim() === ''
          ? 'телефон отсутствует'
          : message;
      invalid.push({ row: i + 1, legacyId, reason });
    }
  }

  // Дубликаты ищем по нормализованному номеру: разные исходные записи
  // («8707…» и «+7707…») склеиваются в один ключ уже после normalizeKzPhone.
  const seen = new Map<string, Row>();
  const duplicates: Array<{ row: number; firstRow: number; phone: string }> = [];
  const unique: Row[] = [];
  for (const row of rows) {
    const first = seen.get(row.phone);
    if (first) {
      duplicates.push({ row: row.row, firstRow: first.row, phone: row.phone });
      continue;
    }
    seen.set(row.phone, row);
    unique.push(row);
  }
  if (duplicates.length && apply) {
    throw new Error(
      `Повторяющиеся телефоны в строках: ${duplicates
        .map((duplicate) => `${duplicate.row}↔${duplicate.firstRow}`)
        .join(', ')}`,
    );
  }

  // Один запрос на тысячу строк вместо двух запросов на строку: иначе
  // прогон 15 000 профилей упирается в round-trip, а не в работу.
  const existing = new Map<
    string,
    {
      id: string;
      phone: string;
      name: string | null;
      pointsBalance: number;
      birthday: Date | null;
    }
  >();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK).map((row) => row.phone);
    const found = await prisma.customer.findMany({
      where: { tenantId: tenant.id, phone: { in: chunk } },
      select: {
        id: true,
        phone: true,
        name: true,
        pointsBalance: true,
        birthday: true,
      },
    });
    for (const customer of found) existing.set(customer.phone, customer);
  }

  const markerPrefix = `Импорт старого приложения [${batch}]`;
  const importedIds = new Set<string>();
  const existingIds = [...existing.values()].map((customer) => customer.id);
  for (let i = 0; i < existingIds.length; i += CHUNK) {
    const found = await prisma.loyaltyTransaction.findMany({
      where: {
        customerId: { in: existingIds.slice(i, i + CHUNK) },
        type: 'ADJUST',
        comment: { startsWith: markerPrefix },
      },
      select: { customerId: true },
    });
    for (const txn of found) importedIds.add(txn.customerId);
  }

  type Planned = Row & {
    action: 'create' | 'update' | 'skip';
    currentPoints: number;
    delta: number;
  };
  const planned: Planned[] = unique.map((row) => {
    const customer = existing.get(row.phone);
    if (customer && importedIds.has(customer.id)) {
      return {
        ...row,
        action: 'skip',
        currentPoints: customer.pointsBalance,
        delta: 0,
      };
    }
    const currentPoints = customer?.pointsBalance ?? 0;
    return {
      ...row,
      action: customer ? 'update' : 'create',
      currentPoints,
      delta: row.points - currentPoints,
    };
  });

  const created = planned.filter((row) => row.action === 'create').length;
  const updated = planned.filter((row) => row.action === 'update').length;
  const skipped = planned.filter((row) => row.action === 'skip').length;
  const pointsTotal = planned
    .filter((row) => row.action !== 'skip')
    .reduce((sum, row) => sum + row.points, 0);
  const pointsDelta = planned
    .filter((row) => row.action !== 'skip')
    .reduce((sum, row) => sum + row.delta, 0);
  const withPoints = planned.filter(
    (row) => row.action !== 'skip' && row.points > 0,
  ).length;
  const lowered = planned.filter(
    (row) => row.action === 'update' && row.delta < 0,
  );

  mkdirSync(reportDir, { recursive: true, mode: 0o700 });

  writeFileSync(
    join(reportDir, 'plan.csv'),
    [
      'row,legacyId,phone,action,currentPoints,plannedPoints,delta,name,birthday',
      ...planned.map((row) =>
        [
          row.row,
          csvCell(row.legacyId),
          csvCell(row.phone),
          row.action,
          row.currentPoints,
          row.points,
          row.delta,
          csvCell(row.name ?? ''),
          csvCell(row.birthday ? row.birthday.toISOString().slice(0, 10) : ''),
        ].join(','),
      ),
    ].join('\n') + '\n',
    { mode: 0o600 },
  );

  writeFileSync(
    join(reportDir, 'rejected.csv'),
    [
      'row,legacyId,reason',
      ...invalid.map((entry) =>
        [entry.row, csvCell(entry.legacyId), csvCell(entry.reason)].join(','),
      ),
    ].join('\n') + '\n',
    { mode: 0o600 },
  );

  if (duplicates.length) {
    writeFileSync(
      join(reportDir, 'duplicates.csv'),
      [
        'row,firstRow,phone',
        ...duplicates.map((entry) =>
          [entry.row, entry.firstRow, csvCell(entry.phone)].join(','),
        ),
      ].join('\n') + '\n',
      { mode: 0o600 },
    );
  }

  // Выборка для ручной сверки с админкой FoodPicasso. Детерминированный шаг
  // вместо случайной выборки: отчёт должен воспроизводиться на тех же данных.
  const sampleRows: Planned[] = [];
  if (sampleSize > 0 && planned.length) {
    const step = Math.max(1, Math.floor(planned.length / sampleSize));
    for (let i = 0; i < planned.length && sampleRows.length < sampleSize; i += step) {
      sampleRows.push(planned[i]);
    }
    writeFileSync(
      join(reportDir, 'sample-check.csv'),
      [
        // Пустые колонки заполняет владелец, глядя в админку FoodPicasso:
        // план и факт должны сойтись построчно.
        'legacyId,phone,name,plannedPoints,балансФП_вручную,совпало',
        ...sampleRows.map((row) =>
          [
            csvCell(row.legacyId),
            csvCell(row.phone),
            csvCell(row.name ?? ''),
            row.points,
            '',
            '',
          ].join(','),
        ),
      ].join('\n') + '\n',
      { mode: 0o600 },
    );
  }

  const reasonCounts: Record<string, number> = {};
  for (const entry of invalid) {
    reasonCounts[entry.reason] = (reasonCounts[entry.reason] ?? 0) + 1;
  }

  let appliedCreated = 0;
  let appliedUpdated = 0;
  if (apply) {
    // Пишем пачками, а не по клиенту за раз. Прогон идёт по SSH-туннелю к
    // Railway, где round-trip ~250 мс: одна транзакция на клиента — это
    // четыре round-trip, то есть больше четырёх часов на 15 000 строк.
    // Пачка в 500 укладывается в те же четыре round-trip целиком.
    const toCreate = planned.filter((row) => row.action === 'create');
    const toUpdate = planned.filter((row) => row.action === 'update');
    const comment = (row: Planned) =>
      `${markerPrefix}: исходный баланс ${row.points}`;

    for (let i = 0; i < toCreate.length; i += WRITE_CHUNK) {
      const chunk = toCreate.slice(i, i + WRITE_CHUNK);
      await prisma.$transaction(
        async (tx) => {
          await tx.customer.createMany({
            data: chunk.map((row) => ({
              tenantId: tenant.id,
              phone: row.phone,
              name: row.name,
              pointsBalance: row.points,
              ...(withBirthday && row.birthday ? { birthday: row.birthday } : {}),
            })),
          });
          // createMany не возвращает id, поэтому забираем их одним запросом
          // по телефонам — они уникальны в пределах арендатора.
          const saved = await tx.customer.findMany({
            where: {
              tenantId: tenant.id,
              phone: { in: chunk.map((row) => row.phone) },
            },
            select: { id: true, phone: true },
          });
          const idByPhone = new Map(saved.map((row) => [row.phone, row.id]));
          await tx.loyaltyTransaction.createMany({
            data: chunk.map((row) => ({
              tenantId: tenant.id,
              customerId: idByPhone.get(row.phone)!,
              type: 'ADJUST' as const,
              amount: row.delta,
              comment: comment(row),
            })),
          });
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
      appliedCreated += chunk.length;
      console.log(`  создано ${appliedCreated}/${toCreate.length}`);
    }

    // Обновления идут по одному внутри общей транзакции: у каждой строки свои
    // значения. Сейчас их единицы, но при финальной дельте их станет много —
    // тогда этот участок и будет узким местом, а не создание.
    for (let i = 0; i < toUpdate.length; i += WRITE_CHUNK) {
      const chunk = toUpdate.slice(i, i + WRITE_CHUNK);
      await prisma.$transaction(
        async (tx) => {
          for (const row of chunk) {
            const customer = existing.get(row.phone)!;
            await tx.customer.update({
              where: { id: customer.id },
              // Данные, которые клиент мог указать уже у нас, старая база
              // не перебивает: заполняем только пустые поля.
              data: {
                pointsBalance: row.points,
                ...(row.name && !customer.name ? { name: row.name } : {}),
                ...(withBirthday && row.birthday && !customer.birthday
                  ? { birthday: row.birthday }
                  : {}),
              },
            });
          }
          await tx.loyaltyTransaction.createMany({
            data: chunk.map((row) => ({
              tenantId: tenant.id,
              customerId: existing.get(row.phone)!.id,
              type: 'ADJUST' as const,
              amount: row.delta,
              comment: comment(row),
            })),
          });
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
      appliedUpdated += chunk.length;
      console.log(`  обновлено ${appliedUpdated}/${toUpdate.length}`);
    }
  }

  const summary = {
    mode: apply ? 'applied' : 'dry-run',
    generatedAt: new Date().toISOString(),
    database: describeDatabase(),
    tenant: tenantSlug,
    batch,
    withBirthday,
    source: csvPath,
    dataRows: lines.length - 1,
    validRows: rows.length,
    uniqueRows: unique.length,
    duplicateRows: duplicates.length,
    invalidRows: invalid.length,
    invalidByReason: reasonCounts,
    plan: { create: created, update: updated, skip: skipped },
    applied: apply ? { create: appliedCreated, update: appliedUpdated } : null,
    points: {
      totalAfterImport: pointsTotal,
      netChange: pointsDelta,
      customersWithPoints: withPoints,
      customersWithZero: unique.length - withPoints - skipped,
      loweredBalances: lowered.length,
    },
    birthdays: {
      parsed: birthdaysParsed,
      enabled: withBirthday,
      willWrite: withBirthday
        ? planned.filter(
            (row) =>
              row.action !== 'skip' &&
              row.birthday &&
              !existing.get(row.phone)?.birthday,
          ).length
        : 0,
    },
    reportDir,
  };

  writeFileSync(
    join(reportDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { mode: 0o600 },
  );

  console.log('');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`Отчёт: ${reportDir}`);
  console.log('  plan.csv         — построчный план');
  console.log('  rejected.csv     — отклонённые строки с причиной');
  console.log('  sample-check.csv — выборка для ручной сверки');
  if (duplicates.length) console.log('  duplicates.csv   — повторяющиеся номера');
  console.log('');
  console.log('Первые строки плана (телефоны замаскированы):');
  for (const row of planned.slice(0, 5)) {
    console.log(
      `  строка ${row.row}: ${maskPhone(row.phone)} ${row.currentPoints} → ${row.points} (${row.action})`,
    );
  }
  if (lowered.length) {
    console.log('');
    console.log(
      `ВНИМАНИЕ: у ${lowered.length} существующих клиентов импорт УМЕНЬШИТ баланс.`,
    );
  }
  if (invalid.length) process.exitCode = 2;
}

// Запускаем импорт только при прямом вызове скрипта: тесты подключают
// этот файл ради parsePoints и не должны требовать путь к CSV.
const executedDirectly =
  process.argv[1] !== undefined &&
  /import-loyalty-balances\.[tj]s$/.test(process.argv[1]);

if (executedDirectly) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
