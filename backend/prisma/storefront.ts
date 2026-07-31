import { PrismaClient } from '@prisma/client';

/**
 * Управление витриной приложения (до появления веб-админки).
 *
 *   npx tsx prisma/storefront.ts list
 *   npx tsx prisma/storefront.ts products "Категория"
 *   npx tsx prisma/storefront.ts order "Комбо" "Сеты" "Пиццы" ...   — порядок категорий
 *   npx tsx prisma/storefront.ts hide-cat "Имя" | show-cat "Имя"
 *   npx tsx prisma/storefront.ts rename-cat "Старое имя" "Новое имя"
 *   npx tsx prisma/storefront.ts hide "Товар" | show "Товар"
 *   npx tsx prisma/storefront.ts rename "Товар (имя в кассе)" "Имя в приложении"
 *   npx tsx prisma/storefront.ts move "Товар" "Категория витрины"
 *
 * Всё действует только на витрину — касса Poster не меняется.
 */
const prisma = new PrismaClient();

async function findProduct(name: string) {
  const matches = await prisma.product.findMany({
    where: { OR: [{ name }, { displayName: name }] },
    include: { posterAccount: { select: { name: true } } },
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    console.error(`Товар «${name}» не найден (ищу по точному имени кассы или витрины)`);
  } else {
    console.error(`Найдено несколько «${name}»:`);
    for (const m of matches) {
      console.error(`  [${m.id}] отдел ${m.posterAccount.name}, ${m.price} ₸`);
    }
    console.error('Уточните имя или скройте лишний дубль.');
  }
  process.exit(1);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'list':
    case undefined: {
      const cats = await prisma.appCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        include: {
          _count: {
            select: {
              products: {
                where: {
                  isActive: true,
                  isVisible: true,
                  category: { isActive: true },
                },
              },
            },
          },
        },
      });
      for (const c of cats) {
        const mark = c.isVisible ? '✓' : '✗';
        console.log(`${String(c.sortOrder).padStart(2)}. ${mark} ${c.name} (${c._count.products})`);
      }
      break;
    }

    case 'products': {
      const cat = await prisma.appCategory.findFirst({ where: { name: args[0] } });
      if (!cat) throw new Error(`Категория «${args[0]}» не найдена`);
      const products = await prisma.product.findMany({
        where: { appCategoryId: cat.id },
        orderBy: [{ sortOverride: { sort: 'asc', nulls: 'last' } }, { sortOrder: 'asc' }],
        include: { posterAccount: { select: { name: true } } },
      });
      for (const p of products) {
        const marks = `${p.isVisible ? '✓' : '✗'}${p.isActive ? '' : ' (стоп-лист кассы)'}`;
        const label = p.displayName ? `${p.displayName} [касса: ${p.name}]` : p.name;
        console.log(`${marks} ${label} — ${p.price} ₸ — ${p.posterAccount.name}`);
      }
      break;
    }

    case 'order': {
      for (let i = 0; i < args.length; i++) {
        const res = await prisma.appCategory.updateMany({
          where: { name: args[i] },
          data: { sortOrder: i + 1 },
        });
        if (res.count === 0) console.warn(`⚠ категория «${args[i]}» не найдена`);
      }
      // не упомянутые — в конец, сохранив относительный порядок
      const rest = await prisma.appCategory.findMany({
        where: { name: { notIn: args } },
        orderBy: { sortOrder: 'asc' },
      });
      for (let i = 0; i < rest.length; i++) {
        await prisma.appCategory.update({
          where: { id: rest[i].id },
          data: { sortOrder: args.length + i + 1 },
        });
      }
      console.log('Порядок обновлён');
      break;
    }

    case 'hide-cat':
    case 'show-cat': {
      const res = await prisma.appCategory.updateMany({
        where: { name: args[0] },
        data: { isVisible: cmd === 'show-cat' },
      });
      console.log(res.count ? 'Готово' : 'Категория не найдена');
      break;
    }

    case 'rename-cat': {
      const res = await prisma.appCategory.updateMany({
        where: { name: args[0] },
        data: { name: args[1] },
      });
      console.log(res.count ? 'Переименовано' : 'Категория не найдена');
      break;
    }

    case 'hide':
    case 'show': {
      const p = await findProduct(args[0]);
      await prisma.product.update({
        where: { id: p!.id },
        data: { isVisible: cmd === 'show' },
      });
      console.log(`«${args[0]}» ${cmd === 'show' ? 'показан' : 'скрыт'}`);
      break;
    }

    case 'rename': {
      const p = await findProduct(args[0]);
      await prisma.product.update({
        where: { id: p!.id },
        data: { displayName: args[1] || null },
      });
      console.log(`«${p!.name}» на витрине: «${args[1]}»`);
      break;
    }

    case 'move': {
      const p = await findProduct(args[0]);
      const cat = await prisma.appCategory.findFirst({ where: { name: args[1] } });
      if (!cat) throw new Error(`Категория «${args[1]}» не найдена`);
      await prisma.product.update({
        where: { id: p!.id },
        data: { appCategoryId: cat.id },
      });
      console.log(`«${p!.name}» → «${cat.name}»`);
      break;
    }

    default:
      console.error('Неизвестная команда. Смотрите шапку файла prisma/storefront.ts');
      process.exit(1);
  }
}

main().finally(() => prisma.$disconnect());
