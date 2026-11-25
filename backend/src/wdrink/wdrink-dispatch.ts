/**
 * Чистые правила отправки части заказа на кассу WDrink (DECISIONS §15).
 * Без базы и сети — чтобы их можно было проверить тестами.
 */

export const WDRINK_KIND = 'WDRINK';

export function isWdrink(account: { kind?: string | null } | null | undefined): boolean {
  return account?.kind === WDRINK_KIND;
}

/**
 * Номер части для WDrink. Повтор с тем же номером WDrink не создаёт
 * заново, поэтому новый состав после нехватки — новый номер: `…:2`, `…:3`.
 */
export function wdrinkExternalId(dispatchId: string, replacedCount: number): string {
  return `${dispatchId}:${replacedCount + 1}`;
}

/**
 * Когда показать заказ на кассе. Обычный — сразу. Предзаказ — за
 * `leadMin` минут до времени: напитки тают и остывают, готовить их за
 * час нельзя.
 */
export function wdrinkShowAt(
  scheduledAt: Date | null | undefined,
  leadMin: number,
  now: Date,
): Date | null {
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt.getTime() - Math.max(0, leadMin) * 60_000);
  return at > now ? at : null;
}

export interface WdrinkLine {
  qty: number;
  price: number;
  product: { posterId: string | null } | null;
}

/**
 * Состав для кассы WDrink: позиция, количество и цена, которую видел клиент.
 * Подарок по акции уходит полной ценой: WeDrink получает за напиток всегда
 * полную цену, скидка — расход PizzBurg.
 */
export function wdrinkItems(lines: WdrinkLine[]) {
  return lines
    .filter((l) => l.product?.posterId)
    .map((l) => ({ item_id: String(l.product!.posterId), qty: l.qty, price: l.price }));
}

/** Сумма к расчёту с WeDrink за принятые части */
export function wdrinkPartTotal(lines: { qty: number; price: number }[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.price, 0);
}
