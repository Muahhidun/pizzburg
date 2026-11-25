import { PrismaClient } from '@prisma/client';
import { WdrinkClient } from '../src/wdrink/wdrink.client';
import { planRelink } from '../src/wdrink/wdrink-relink';

/**
 * День перехода (DECISIONS §15): напитки приложения переезжают из отдела
 * Poster «Sunday» на кассу WDrink. Товары не пересоздаются — те же записи
 * получают новый отдел и номер позиции WDrink, поэтому фото, описания,
 * витринные имена, избранное и история заказов остаются.
 *
 *   npx tsx prisma/wdrink-relink.ts --from "Sunday" --category "WeDrink" --to "WeDrink"
 *   …то же самое с --apply — записать
 *   --map <productId>=<номер позиции WDrink>  — подсказать пару вручную (можно несколько)
 *
 * Без --apply только печатает план. Отдел WDrink должен быть уже подключён
 * в админке (адрес и ключ).
 */
const prisma = new PrismaClient();

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function args(name: string) {
  return process.argv.flatMap((v, i, all) => (v === `--${name}` ? [all[i + 1]] : []));
}

async function main() {
  const fromName = arg('from');
  const categoryName = arg('category');
  const toName = arg('to');
  const apply = process.argv.includes('--apply');
  const tenantSlug = arg('tenant') ?? 'pizzburg';
  if (!fromName || !categoryName || !toName) {
    console.error('Нужно: --from <отдел Poster> --category <категория Poster> --to <отдел WDrink>');
    process.exit(1);
  }
  const overrides = Object.fromEntries(args('map').map((pair) => pair.split('=')));

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
  const from = await prisma.posterAccount.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: tenant.id, name: fromName } },
  });
  const to = await prisma.posterAccount.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: tenant.id, name: toName } },
  });
  if (to.kind !== 'WDRINK') throw new Error(`Отдел «${toName}» — не касса WDrink`);

  const products = await prisma.product.findMany({
    where: { posterAccountId: from.id, category: { name: categoryName } },
    select: { id: true, name: true, displayName: true, price: true, isVisible: true },
    orderBy: { name: 'asc' },
  });
  const menu = await new WdrinkClient().getMenu(to);
  const plan = planRelink(products, menu.items, overrides);

  console.log(`Напитков в «${fromName}» / «${categoryName}»: ${products.length}`);
  console.log(`В доставке на кассе «${toName}»: ${menu.items.length}\n`);
  console.log(`Совпали (${plan.matched.length}):`);
  for (const m of plan.matched) {
    console.log(
      `  ${m.product.displayName ?? m.product.name}  →  [${m.item.id}] ${m.item.name}` +
        (m.priceDiffers ? `   ⚠ цена ${m.product.price} → ${m.item.price} ₸` : ''),
    );
  }
  if (plan.ambiguous.length) {
    console.log(`\nНесколько товаров на одну позицию — укажите --map (${plan.ambiguous.length}):`);
    for (const a of plan.ambiguous) {
      console.log(`  [${a.item.id}] ${a.item.name}: ${a.products.map((p) => `${p.name} (${p.id})`).join(', ')}`);
    }
  }
  if (plan.unmatchedProducts.length) {
    console.log(`\nНет пары на кассе WDrink — останутся в Sunday (${plan.unmatchedProducts.length}):`);
    for (const p of plan.unmatchedProducts) console.log(`  ${p.name}  (${p.id})`);
  }
  if (plan.unmatchedItems.length) {
    console.log(`\nЕсть на кассе, нет в приложении — появятся скрытыми (${plan.unmatchedItems.length}):`);
    for (const i of plan.unmatchedItems) console.log(`  [${i.id}] ${i.name}`);
  }

  if (!apply) {
    console.log('\nПробный прогон: ничего не записано. Для записи добавьте --apply.');
    return;
  }

  const categoryById = new Map(menu.categories.map((c) => [c.id, c]));
  await prisma.$transaction(async (tx) => {
    for (const { product, item } of plan.matched) {
      const wc = categoryById.get(item.category_id);
      const category = await tx.category.upsert({
        where: { posterAccountId_posterId: { posterAccountId: to.id, posterId: item.category_id } },
        create: {
          tenantId: tenant.id,
          posterAccountId: to.id,
          posterId: item.category_id,
          name: wc?.name ?? categoryName,
          sortOrder: wc?.sort ?? 0,
        },
        update: {},
      });
      // Синк мог уже завести эту позицию скрытым дублем — он пустой
      // (заказов на скрытый товар нет), его место занимает настоящий
      const twin = await tx.product.findUnique({
        where: { posterAccountId_posterId: { posterAccountId: to.id, posterId: item.id } },
        select: { id: true, _count: { select: { orderItems: true, favorites: true } } },
      });
      if (twin && twin.id !== product.id) {
        if (twin._count.orderItems > 0 || twin._count.favorites > 0) {
          throw new Error(`У позиции [${item.id}] уже есть заказы в отделе WDrink — разберите вручную`);
        }
        await tx.upsellItem.deleteMany({ where: { productId: twin.id } });
        await tx.product.delete({ where: { id: twin.id } });
      }
      await tx.product.update({
        where: { id: product.id },
        data: {
          posterAccountId: to.id,
          posterId: item.id,
          categoryId: category.id,
          price: item.price,
          // Имя в приложении не должно смениться на кассовое имя WDrink
          displayName: product.displayName ?? product.name,
          modifiers: [],
        },
      });
    }
  });
  console.log(`\nЗаписано: ${plan.matched.length} напитков теперь уходят на кассу «${toName}».`);
  console.log(`Теперь можно удалить категорию «${categoryName}» в Poster «${fromName}».`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
