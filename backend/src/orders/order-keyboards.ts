import { esc, InlineButton } from '../telegram/telegram.service';

/**
 * Кнопки под сообщением о заказе в группе кассиров — чистые функции,
 * без сервисов: их импортирует и OrdersService, и обработчик нажатий.
 *
 * Данные кнопки: `o:<шаг>:<id заказа>[:<аргумент>]`. Телеграм даёт на них
 * 64 байта; id заказа — cuid в 25 знаков, влезает с запасом.
 */

/** Сколько позиций умещаем в выбор «нет позиции»: маска — число до 2^40 */
const MAX_PICK_ITEMS = 40;

/**
 * Принятый заказ (на планшете или кнопкой) помечен строкой «✅ Принят» над
 * «Действиями»: кассир сразу видит, какие заказы ещё надо принять (Дом,
 * 26.11.2026). Это метка, нажатие только подсказывает.
 */
export function actionsButton(orderId: string, accepted = false): InlineButton[][] {
  const actions = [[{ text: '⋯ Действия', callback_data: `o:m:${orderId}` }]];
  return accepted ? [[{ text: '✅ Принят', callback_data: `o:i:${orderId}` }], ...actions] : actions;
}

/** Заказ уже принят: всё, кроме нового и отменённого */
export function isAccepted(status: string): boolean {
  return status !== 'NEW' && status !== 'CANCELLED';
}

export function menuKeyboard(orderId: string, accepted = false): InlineButton[][] {
  return [
    // Глагол, а не метка: «✅ Принят» читался как статус (Дом, 28.11.2026)
    ...(accepted ? [] : [[{ text: '✅ Принять заказ', callback_data: `o:a:${orderId}` }]]),
    [
      { text: '❌ Отменить', callback_data: `o:c:${orderId}` },
      { text: '🚫 Нет позиции', callback_data: `o:s:${orderId}:` },
    ],
    [{ text: '◂ Свернуть', callback_data: `o:x:${orderId}` }],
  ];
}

export function reasonsKeyboard(
  orderId: string,
  reasons: Array<{ id: string; label: string }>,
): InlineButton[][] {
  const rows: InlineButton[][] = reasons
    .filter((r) => `o:cr:${orderId}:${r.id}`.length <= 64)
    .map((r) => [{ text: r.label, callback_data: `o:cr:${orderId}:${r.id}` }]);
  rows.push([{ text: '◂ Назад', callback_data: `o:m:${orderId}` }]);
  return rows;
}

export function confirmKeyboard(
  orderId: string,
  reasonId: string,
  reasonLabel: string,
  refunds: boolean,
): InlineButton[][] {
  return [
    [{ text: `Причина: ${reasonLabel}`, callback_data: `o:c:${orderId}` }],
    [
      {
        text: refunds ? '❌ Да, отменить и вернуть деньги' : '❌ Да, отменить',
        callback_data: `o:cy:${orderId}:${reasonId}`,
      },
    ],
    [{ text: '↩️ Не отменять', callback_data: `o:x:${orderId}` }],
  ];
}

/**
 * Подтверждение «Принять»: клиенту сразу уходит пуш, поэтому — второй шаг.
 *
 * Кнопка — призыв нажать, а не утверждение. «✅ Да, заказ принят» кассир
 * прочла как итог, второй раз не нажала, и №357 так и остался «Новым»:
 * через 3 часа автомат отменил его и вернул деньги за отданную еду
 * (27.11.2026).
 */
export function acceptKeyboard(orderId: string): InlineButton[][] {
  return [
    [{ text: '👉 Нажмите, чтобы принять заказ', callback_data: `o:ay:${orderId}` }],
    [{ text: '◂ Назад', callback_data: `o:m:${orderId}` }],
  ];
}

export interface PickItem {
  id: string;
  name: string;
  qty: number;
}

/** Выбранные позиции храним в самой кнопке — битовой маской в base36 */
export function parseMask(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 36) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function shortageKeyboard(
  orderId: string,
  items: PickItem[],
  mask: number,
): InlineButton[][] {
  const rows: InlineButton[][] = items.slice(0, MAX_PICK_ITEMS).map((it, i) => {
    const on = (mask & 2 ** i) !== 0;
    const next = on ? mask - 2 ** i : mask + 2 ** i;
    return [
      {
        text: `${on ? '☑️' : '⬜️'} ${it.qty > 1 ? `${it.qty}× ` : ''}${it.name}`,
        callback_data: `o:s:${orderId}:${next.toString(36)}`,
      },
    ];
  });
  rows.push(
    mask > 0
      ? [
          { text: '◂ Назад', callback_data: `o:m:${orderId}` },
          { text: '📩 Спросить клиента', callback_data: `o:sy:${orderId}:${mask.toString(36)}` },
        ]
      : [{ text: '◂ Назад', callback_data: `o:m:${orderId}` }],
  );
  return rows;
}

/** Выбранные id позиций по маске */
export function pickedIds(items: PickItem[], mask: number): string[] {
  return items.slice(0, MAX_PICK_ITEMS).filter((_, i) => (mask & 2 ** i) !== 0).map((it) => it.id);
}

export function acceptedBanner(by: string, at: Date, tz: string): string {
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return `✅ <b>ПРИНЯТ</b> в Телеграме — ${esc(by)}, ${time}`;
}

export function cancelledBanner(by: string, at: Date, reason: string, tz: string): string {
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return `🚫 <b>ОТМЕНЁН</b> — ${esc(by)}, ${time}. Причина: ${esc(reason)}`;
}


/**
 * Чек не дошёл до Poster: отправить ещё раз или отметить, что кассир
 * пробил его вручную (тогда повтор дал бы второй чек).
 */
export function dispatchFailedKeyboard(orderId: string): InlineButton[][] {
  return [
    [{ text: '🔁 Отправить в Poster ещё раз', callback_data: `o:rs:${orderId}` }],
    [{ text: '✍️ Пробили вручную — принять заказ', callback_data: `o:mn:${orderId}` }],
  ];
}

/**
 * Оплаченный заказ 3 часа никто не принял: деньги сами не возвращаем,
 * спрашиваем кассу. «Отменить» ведёт в обычную отмену с причиной.
 */
export function staleOrderKeyboard(orderId: string): InlineButton[][] {
  return [
    [{ text: '✅ Еду отдали — закрыть как выданный', callback_data: `o:dv:${orderId}` }],
    [{ text: '❌ Не отдали — отменить и вернуть деньги', callback_data: `o:c:${orderId}` }],
  ];
}
