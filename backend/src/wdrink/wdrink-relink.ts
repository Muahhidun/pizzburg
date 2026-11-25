/**
 * Сопоставление напитков, заведённых в Poster Sunday, с меню кассы WDrink
 * (DECISIONS §15, «День перехода»). Чистая функция — проверяется тестами,
 * сам перенос делает `prisma/wdrink-relink.ts`.
 */

/** Имя для сравнения: регистр, ё, пробелы, «0.7»/«0,7», «л», скобки */
export function drinkKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)[.,](\d)/g, '$1,$2')
    .replace(/(\d)\s*л(?![а-яa-z])/g, '$1')
    .replace(/[()«»"'.\-–—/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RelinkProduct {
  id: string;
  name: string;
  displayName: string | null;
  price: number;
}

export interface RelinkItem {
  id: string;
  name: string;
  price: number;
  category_id: string;
}

export interface RelinkPlan {
  matched: { product: RelinkProduct; item: RelinkItem; priceDiffers: boolean }[];
  /** Напитки приложения, которым на кассе WDrink пары нет */
  unmatchedProducts: RelinkProduct[];
  /** Напитки кассы WDrink «в доставке», которых нет в приложении */
  unmatchedItems: RelinkItem[];
  /** Одно имя кассы — несколько товаров приложения: решить руками */
  ambiguous: { item: RelinkItem; products: RelinkProduct[] }[];
}

export function planRelink(
  products: RelinkProduct[],
  items: RelinkItem[],
  overrides: Record<string, string> = {},
): RelinkPlan {
  const itemsByKey = new Map<string, RelinkItem[]>();
  for (const item of items) {
    const key = drinkKey(item.name);
    itemsByKey.set(key, [...(itemsByKey.get(key) ?? []), item]);
  }
  const itemById = new Map(items.map((i) => [i.id, i]));

  const byItem = new Map<string, RelinkProduct[]>();
  const unmatchedProducts: RelinkProduct[] = [];
  for (const p of products) {
    const forced = overrides[p.id] ? itemById.get(overrides[p.id]) : undefined;
    const candidates = forced
      ? [forced]
      : (itemsByKey.get(drinkKey(p.name)) ??
        (p.displayName ? itemsByKey.get(drinkKey(p.displayName)) : undefined) ??
        []);
    if (candidates.length !== 1) {
      unmatchedProducts.push(p);
      continue;
    }
    byItem.set(candidates[0].id, [...(byItem.get(candidates[0].id) ?? []), p]);
  }

  const matched: RelinkPlan['matched'] = [];
  const ambiguous: RelinkPlan['ambiguous'] = [];
  for (const [itemId, list] of byItem) {
    const item = itemById.get(itemId)!;
    if (list.length > 1) ambiguous.push({ item, products: list });
    else matched.push({ product: list[0], item, priceDiffers: list[0].price !== item.price });
  }
  const used = new Set([...byItem.keys()]);
  return {
    matched,
    unmatchedProducts,
    unmatchedItems: items.filter((i) => !used.has(i.id)),
    ambiguous,
  };
}
