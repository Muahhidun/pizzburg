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

export function actionsButton(orderId: string): InlineButton[][] {
  return [[{ text: '⋯ Действия', callback_data: `o:m:${orderId}` }]];
}

export function menuKeyboard(orderId: string): InlineButton[][] {
  return [
    [{ text: '✅ Принят', callback_data: `o:a:${orderId}` }],
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

/** Подтверждение «Принят»: клиенту сразу уходит пуш, поэтому — второй шаг */
export function acceptKeyboard(orderId: string): InlineButton[][] {
  return [
    [{ text: '✅ Да, заказ принят', callback_data: `o:ay:${orderId}` }],
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

