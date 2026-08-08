import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { normalizeKzPhone } from '../src/common/phone';

/**
 * Безопасный импорт балансов СТАРОГО ПРИЛОЖЕНИЯ (не бонусов Poster).
 *
 * CSV: phone,points,name (также понимает ;, tab и русские заголовки).
 * По умолчанию только показывает план; запись — лишь с --apply.
 * Повтор того же --batch пропускается по метке в журнале.
 *
 * npx tsx prisma/import-loyalty-balances.ts balances.csv
 * npx tsx prisma/import-loyalty-balances.ts balances.csv --apply --batch=legacy-2026-08
 */

const prisma = new PrismaClient();

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

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) throw new Error('Укажите путь к CSV-файлу');

  const apply = args.includes('--apply');
  const tenantSlug =
    args.find((arg) => arg.startsWith('--tenant='))?.slice(9) || 'pizzburg';
  const batch =
    args.find((arg) => arg.startsWith('--batch='))?.slice(8) || basename(file);
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(batch)) {
    throw new Error('Некорректный --batch: используйте буквы, цифры, точку, _ или -');
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error(`Тенант «${tenantSlug}» не найден`);

  const text = readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '');
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
  if (phoneIndex < 0 || pointsIndex < 0) {
    throw new Error('Нужны колонки phone/телефон и points/balance/баланс');
  }

  const rows: Array<{ row: number; phone: string; points: number; name?: string }> = [];
  const invalid: Array<{ row: number; error: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const cells = parseLine(lines[i], delimiter);
      const phone = normalizeKzPhone(cells[phoneIndex] ?? '');
      const rawPoints = (cells[pointsIndex] ?? '').replace(/\s/g, '');
      const points = Number(rawPoints);
      if (!Number.isInteger(points) || points < 0 || points > 10_000_000) {
        throw new Error('баланс должен быть целым числом от 0 до 10 000 000');
      }
      rows.push({
        row: i + 1,
        phone,
        points,
        name: nameIndex >= 0 ? cells[nameIndex] || undefined : undefined,
      });
    } catch (error) {
      invalid.push({ row: i + 1, error: String(error) });
    }
  }

  const duplicates = rows.filter(
    (row, index) => rows.findIndex((candidate) => candidate.phone === row.phone) !== index,
  );
  if (duplicates.length) {
    throw new Error(
      `Повторяющиеся телефоны в строках: ${duplicates.map((row) => row.row).join(', ')}`,
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const markerPrefix = `Импорт старого приложения [${batch}]`;

  for (const row of rows) {
    const customer = await prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone: row.phone } },
    });
    const alreadyImported = customer
      ? await prisma.loyaltyTransaction.findFirst({
          where: {
            customerId: customer.id,
            type: 'ADJUST',
            comment: { startsWith: markerPrefix },
          },
        })
      : null;
    if (alreadyImported) {
      skipped++;
      continue;
    }

    const current = customer?.pointsBalance ?? 0;
    const delta = row.points - current;
    console.log(
      `${apply ? 'APPLY' : 'PLAN '} строка ${row.row}: ${row.phone} ${current} → ${row.points} (${delta >= 0 ? '+' : ''}${delta})`,
    );
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      const saved = customer
        ? await tx.customer.update({
            where: { id: customer.id },
            data: {
              pointsBalance: row.points,
              ...(row.name && !customer.name ? { name: row.name } : {}),
            },
          })
        : await tx.customer.create({
            data: {
              tenantId: tenant.id,
              phone: row.phone,
              name: row.name,
              pointsBalance: row.points,
            },
          });
      await tx.loyaltyTransaction.create({
        data: {
          tenantId: tenant.id,
          customerId: saved.id,
          type: 'ADJUST',
          amount: delta,
          comment: `${markerPrefix}: исходный баланс ${row.points}`,
        },
      });
    });
    if (customer) updated++;
    else created++;
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'applied' : 'dry-run',
        batch,
        validRows: rows.length,
        invalidRows: invalid.length,
        created,
        updated,
        skipped,
        invalid,
      },
      null,
      2,
    ),
  );
  if (invalid.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
