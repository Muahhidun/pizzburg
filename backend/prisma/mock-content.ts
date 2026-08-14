import { PrismaClient } from '@prisma/client';

/**
 * Демо-контент витрины: описания, веса и метки.
 *
 * Нужен, чтобы каталог не выглядел пустым, пока владелец не залил
 * настоящие тексты и фото. Правит ТОЛЬКО витринные поля
 * (`displayDescription`, `weightLabel`, метки) — данные из Poster
 * (`name`, `price`, `isActive`, категория) не трогаются никогда.
 *
 * Товар ищется по кассовому имени: у витринных полей нет стабильного
 * ключа, а имена в Poster уникальны в пределах отдела.
 *
 * Идемпотентен: повторный запуск перезапишет те же поля теми же
 * значениями. Не перетирает то, что владелец уже заполнил вручную,
 * если запускать с --keep-existing.
 *
 *   npx tsx prisma/mock-content.ts              — проставить демо-тексты
 *   npx tsx prisma/mock-content.ts --keep-existing
 *   npx tsx prisma/mock-content.ts --clear      — убрать демо-тексты
 */

const prisma = new PrismaClient();

type Mock = {
  name: string;
  description: string;
  weight?: string;
  hit?: boolean;
  spicy?: boolean;
  fresh?: boolean;
};

const CONTENT: Mock[] = [
  {
    name: 'Маргарита',
    description:
      'Классика, с которой всё начинается: томатный соус, моцарелла и свежий базилик на тонком тесте.',
    weight: '480 г · 30 см',
    hit: true,
  },
  {
    name: 'Пиццбург',
    description:
      'Наша фирменная: пепперони, ветчина, охотничьи колбаски, шампиньоны и двойная моцарелла.',
    weight: '620 г · 30 см',
    hit: true,
  },
  {
    name: '4 Сыра',
    description:
      'Моцарелла, пармезан, гауда и голубой сыр на сливочном соусе. Для тех, кто любит понасыщеннее.',
    weight: '540 г · 30 см',
  },
  {
    name: 'Пикантная',
    description:
      'Пепперони, халапеньо, красный лук и острый соус. Жжёт ровно столько, сколько нужно.',
    weight: '560 г · 30 см',
    spicy: true,
  },
  {
    name: '4 Сезона',
    description:
      'Четыре четверти — четыре вкуса: пепперони, ветчина с грибами, курица и четыре сыра.',
    weight: '600 г · 30 см',
  },
  {
    name: 'Курица и грибы',
    description:
      'Куриное филе, шампиньоны, моцарелла и сливочный соус. Мягкий вкус без остроты.',
    weight: '570 г · 30 см',
  },
  {
    name: 'Классический бургер',
    description:
      'Говяжья котлета на гриле, свежие овощи, сыр чеддер и фирменный соус в мягкой булочке.',
    weight: '260 г',
    hit: true,
  },
  {
    name: 'Двойной бургер',
    description:
      'Две говяжьи котлеты, двойной чеддер, маринованные огурцы и соус барбекю.',
    weight: '390 г',
  },
  {
    name: 'Гриль Бургер',
    description:
      'Куриное филе на гриле, листья салата, томаты и лёгкий чесночный соус.',
    weight: '270 г',
  },
  {
    name: 'Грибной бургер',
    description:
      'Говяжья котлета, обжаренные шампиньоны, плавленый сыр и сливочный соус.',
    weight: '280 г',
    fresh: true,
  },
  {
    name: 'Хот-Дог говяжий',
    description:
      'Говяжья сосиска, свежая булочка, маринованные огурчики и три соуса на выбор.',
    weight: '210 г',
  },
  {
    name: 'Хот-Дог куриный',
    description:
      'Куриная сосиска, хрустящий лук, сыр и горчично-медовый соус.',
    weight: '200 г',
  },
  {
    name: 'Комбо Донер',
    description:
      'Донер маленький, картофель фри и напиток 0,5 л. Вместе выгоднее, чем по отдельности.',
    weight: '520 г',
    hit: true,
  },
  {
    name: 'Комбо Хот-Дог',
    description:
      'Хот-дог куриный, картофель фри и кола 0,5 л — быстрый полноценный обед.',
    weight: '480 г',
  },
  {
    name: 'Комбо Чизбургер',
    description: 'Чизбургер, картофель фри и напиток 0,5 л одним заказом.',
    weight: '500 г',
  },
];

async function main() {
  const args = process.argv.slice(2);
  const clear = args.includes('--clear');
  const keepExisting = args.includes('--keep-existing');

  const tenant = await prisma.tenant.findUnique({ where: { slug: 'pizzburg' } });
  if (!tenant) throw new Error('Тенант pizzburg не найден');

  let updated = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const mock of CONTENT) {
    const products = await prisma.product.findMany({
      where: { tenantId: tenant.id, name: mock.name },
      select: { id: true, displayDescription: true, weightLabel: true },
    });
    if (products.length === 0) {
      missing.push(mock.name);
      continue;
    }

    for (const product of products) {
      if (
        keepExisting &&
        (product.displayDescription || product.weightLabel)
      ) {
        skipped++;
        continue;
      }
      await prisma.product.update({
        where: { id: product.id },
        data: clear
          ? {
              displayDescription: null,
              weightLabel: null,
              isHit: false,
              isSpicy: false,
              isNew: false,
            }
          : {
              displayDescription: mock.description,
              weightLabel: mock.weight ?? null,
              isHit: mock.hit ?? false,
              isSpicy: mock.spicy ?? false,
              isNew: mock.fresh ?? false,
            },
      });
      updated++;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: clear ? 'cleared' : 'applied',
        updated,
        skipped,
        missing,
      },
      null,
      2,
    ),
  );
  if (missing.length) {
    console.log(
      'Не найдены в кассе (возможно, переименованы): ' + missing.join(', '),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
