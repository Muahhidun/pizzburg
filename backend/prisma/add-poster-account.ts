import { PrismaClient } from '@prisma/client';

/**
 * Добавить/обновить аккаунт Poster (отдел) для тенанта pizzburg.
 * Использование: npx tsx prisma/add-poster-account.ts "<Название>" <токен> [sortOrder]
 * Примеры:
 *   npx tsx prisma/add-poster-account.ts "Основной" abc123 0
 *   npx tsx prisma/add-poster-account.ts "Sunday" def456 1
 */
const prisma = new PrismaClient();

async function main() {
  const [name, token, sortOrder] = process.argv.slice(2);
  if (!name || !token) {
    console.error('Использование: npx tsx prisma/add-poster-account.ts "<Название>" <токен> [sortOrder]');
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'pizzburg' } });
  const acc = await prisma.posterAccount.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name } },
    create: { tenantId: tenant.id, name, token, sortOrder: Number(sortOrder ?? 0) },
    update: { token, sortOrder: Number(sortOrder ?? 0), isActive: true },
  });
  console.log(`Аккаунт Poster «${acc.name}» сохранён (id ${acc.id})`);
}

main().finally(() => prisma.$disconnect());
