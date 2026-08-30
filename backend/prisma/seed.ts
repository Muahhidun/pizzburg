import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Стартовые данные: тенант PizzBurg + точка на фудкорте.
 * Токен Poster НЕ хранится в коде — добавьте его после сида:
 *   npx tsx prisma/set-poster-token.ts <токен>
 */
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'pizzburg' },
    update: {},
    create: {
      slug: 'pizzburg',
      name: 'PizzBurg',
      settings: {
        loyalty: { levels: [{ level: 1, name: 'Новичок', cashbackPct: 3 }] },
        currency: 'KZT',
        support: {
          phone: '+7 777 320 04 00',
          email: 'muahhidun@gmail.com',
          hours: 'ежедневно с 10:00 до 21:20',
        },
      },
      venues: {
        create: {
          name: 'PizzBurg MaxiMall',
          address: 'Экибастуз, Ауэзова 47б, ТРЦ «MaxiMall», 3 этаж',
          workingHours: {
            mon: ['10:00', '22:00'],
            tue: ['10:00', '22:00'],
            wed: ['10:00', '22:00'],
            thu: ['10:00', '22:00'],
            fri: ['10:00', '22:00'],
            sat: ['10:00', '22:00'],
            sun: ['10:00', '22:00'],
          },
        },
      },
    },
  });
  console.log(`Tenant ready: ${tenant.slug} (${tenant.id})`);
}

main().finally(() => prisma.$disconnect());
