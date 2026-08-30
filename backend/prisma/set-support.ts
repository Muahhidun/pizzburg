import { PrismaClient } from '@prisma/client';

/**
 * Записать публичные контакты страницы поддержки в Tenant.settings.
 *
 * npx tsx prisma/set-support.ts <tenantSlug> <phone> <email> <hours>
 */
const prisma = new PrismaClient();

async function main() {
  const [slug, phone, email, hours] = process.argv.slice(2);
  if (!slug || !phone || !email || !hours) {
    console.error(
      'Использование: npx tsx prisma/set-support.ts <tenantSlug> <phone> <email> <hours>',
    );
    process.exitCode = 1;
    return;
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { settings: { ...settings, support: { phone, email, hours } } },
  });
  console.log(`Контакты поддержки «${tenant.name}» сохранены`);
}

main().finally(() => prisma.$disconnect());
