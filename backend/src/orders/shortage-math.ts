/**
 * Пересчёт заказа после того, как позиции не оказалось (DECISIONS §12.9).
 *
 * Вынесено из сервиса отдельным модулем без зависимостей: это ровно та
 * часть, где ошибка стоит денег в обе стороны — клиент платит за то, чего
 * не привезли, либо смена не сходится с кассой, — и её нужно проверять
 * тестом, а не боевым заказом.
 *
 * Главное правило пересчёта: **выгода клиента может только уменьшиться от
 * пропажи позиции, но никогда не вырасти, и сумма к оплате не может стать
 * больше исходной.** Нехватка — наша вина; человек не должен за неё ни
 * доплачивать, ни неожиданно получать подарок, от которого он при
 * оформлении отказался в пользу баллов.
 */

export interface ShortageLine {
  /// Цена строки без модификаторов, ₸
  price: number;
  qty: number;
  /// Выбранные модификаторы — их цена входит в стоимость строки
  modifiers?: { price?: number | null }[] | null;
}

/**
 * Стоимость строки заказа для клиента.
 *
 * Формула повторяет расчёт при оформлении (`OrdersService.createOrder`):
 * цена позиции плюс цены выбранных модификаторов, всё это на количество.
 * Иначе пересчёт заказа, из которого ничего не убрали, дал бы сумму,
 * отличную от сохранённой.
 */
export function lineTotal(item: ShortageLine): number {
  const modifiers = (item.modifiers ?? []).reduce(
    (sum, m) => sum + Number(m?.price ?? 0),
    0,
  );
  return (item.price + modifiers) * item.qty;
}

export interface RecalcInput {
  /// Оставшиеся оплачиваемые позиции: без подарков и без снятых
  remaining: ShortageLine[];
  /// Стоимость подарков после переоценки акций (клиент их не платит)
  giftValue: number;
  /// Денежная скидка после переоценки, ₸
  moneyDiscount: number;
  /// Доставка из исходного заказа
  deliveryFee: number;
  /// Сколько баллов было списано при оформлении
  pointsSpent: number;
  /// Сумма к оплате в исходном заказе — потолок для новой
  originalTotal: number;
}

export interface RecalcResult {
  subtotal: number;
  deliveryFee: number;
  moneyDiscount: number;
  /// Сколько баллов остаётся списанными
  pointsSpent: number;
  /// Сколько баллов вернуть клиенту — заказ подешевел
  pointsRefund: number;
  /// Вся выгода одной строкой: подарки + скидка + баллы (как в модели)
  discount: number;
  total: number;
}

export function recalcAfterShortage(input: RecalcInput): RecalcResult {
  const subtotal = input.remaining.reduce((sum, i) => sum + lineTotal(i), 0);

  // Доставку не пересчитываем. Формально порог бесплатной доставки мог
  // перестать выполняться, но выставить за неё счёт после того, как мы
  // сами не смогли собрать заказ, — худшее, что можно сделать.
  const deliveryFee = input.deliveryFee;

  // Скидка не может превысить оставшиеся товары, иначе «Личная
  // интеграция» в Poster уйдёт в минус и смена не сойдётся.
  const moneyDiscount = Math.max(0, Math.min(input.moneyDiscount, subtotal));

  const payableBeforePoints = Math.max(
    0,
    subtotal + deliveryFee - moneyDiscount,
  );

  // Баллами нельзя оплатить больше, чем осталось к оплате: лишние
  // возвращаются на счёт. Иначе клиент заплатил бы баллами за роллы,
  // которых не привезли.
  const pointsSpent = Math.min(input.pointsSpent, payableBeforePoints);
  const pointsRefund = input.pointsSpent - pointsSpent;

  const total = Math.min(
    payableBeforePoints - pointsSpent,
    input.originalTotal,
  );

  return {
    subtotal,
    deliveryFee,
    moneyDiscount,
    pointsSpent,
    pointsRefund,
    discount: input.giftValue + moneyDiscount + pointsSpent,
    total,
  };
}

/**
 * Оставляет от переоценённых акций только то, что уже было в заказе.
 *
 * Пропажа позиции может отобрать подарок, но не может его выдать. Прямая
 * переоценка это правило нарушает: клиент мог при оформлении сознательно
 * отказаться от акции ради баллов (`skipPromotions`), и тогда пересчёт
 * вернул бы ему подарок, которого он не выбирал, — с расхождением по
 * «Личной интеграции» на кассе.
 */
export function shrinkToOriginal<T extends { productId: string; qty: number }>(
  recalculated: T[],
  original: { productId: string | null; qty: number }[],
): T[] {
  const budget = new Map<string, number>();
  for (const item of original) {
    if (!item.productId) continue;
    budget.set(item.productId, (budget.get(item.productId) ?? 0) + item.qty);
  }
  const kept: T[] = [];
  for (const gift of recalculated) {
    const available = budget.get(gift.productId) ?? 0;
    const qty = Math.min(gift.qty, available);
    if (qty <= 0) continue;
    budget.set(gift.productId, available - qty);
    kept.push({ ...gift, qty });
  }
  return kept;
}
