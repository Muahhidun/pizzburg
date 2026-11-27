/**
 * История заказов курьера за смену — для сверки (Дом, 27.11.2026): номер,
 * улица и дом, состав, сумма, оплата; по наличным — сколько взять с
 * клиента, сколько сдачи дала касса и сдано ли это кассиру.
 *
 * Телефона, имени, квартиры и комментария клиента здесь нет нарочно:
 * история нужна для отчёта, а не чтобы курьер потом мог написать клиенту.
 */

import { itemsLine } from './assignment.service';
import { externalOf, orderOf } from './task-order';

type CashEntry = {
  taskId: string | null;
  type: string;
  status: string;
  amount: number;
  paidBy: string | null;
};

type HistoryTask = {
  id: string;
  kind: string;
  status: string;
  deliveredAt: Date | null;
  updatedAt: Date;
  extraReason: string | null;
  external: unknown;
  order: {
    number: number;
    total: number;
    paymentMethod: string;
    address: unknown;
    items: { id: string; name: string; qty: number; modifiers: unknown; isGift: boolean; isUnavailable: boolean }[];
  } | null;
};

export type CashState = 'ON_HAND' | 'PARTLY' | 'HANDED_IN';

export type HistoryRow = {
  id: string;
  number: string;
  status: 'DELIVERED' | 'FAILED';
  at: string;
  address: string;
  items: string;
  total: number;
  payment: string;
  /** Только у заказов за наличные */
  cash: {
    /** Наличные за заказ */
    order: number;
    /** Сдача, которую касса положила курьеру для клиента */
    change: number;
    /** Сколько сдать кассиру за этот заказ */
    owed: number;
    state: CashState;
    /** «Клиент оплатил иначе»: ждём кассира / подтверждено / отказано */
    paidOtherwise: { status: string; paidBy: string | null } | null;
  } | null;
};

const PAYMENT: Record<string, string> = {
  CASH: 'Наличные',
  CARD_ON_DELIVERY: 'Картой, терминал',
  KASPI_ONLINE: 'Kaspi онлайн',
};

/** Улица и дом — без подъезда, квартиры и комментария */
export function shortAddress(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '—';
  const a = raw as { street?: string; house?: string };
  return [a.street?.trim(), a.house?.trim()].filter(Boolean).join(', ') || '—';
}

/**
 * Что из наличных ещё на руках. Сдают кассиру общей суммой, а не по
 * заказам, поэтому считаем, что сдано самое раннее: на руках — последние
 * заказы на сумму баланса. Строки — от новых к старым.
 */
export function cashStates(owed: number[], onHand: number): CashState[] {
  let left = Math.max(onHand, 0);
  return owed.map((amount) => {
    if (amount <= 0) return 'HANDED_IN';
    if (left >= amount) {
      left -= amount;
      return 'ON_HAND';
    }
    if (left > 0) {
      left = 0;
      return 'PARTLY';
    }
    return 'HANDED_IN';
  });
}

export function historyRows(tasks: HistoryTask[], entries: CashEntry[], onHand: number): HistoryRow[] {
  const byTask = new Map<string, CashEntry[]>();
  for (const e of entries) {
    if (!e.taskId) continue;
    byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
  }

  const rows = tasks.map((t) => {
    const o = orderOf(t);
    const ext = externalOf(t.external);
    const mine = byTask.get(t.id) ?? [];
    const sum = (type: string) =>
      mine.filter((e) => e.type === type && e.status === 'CONFIRMED').reduce((s, e) => s + e.amount, 0);
    const collected = sum('COLLECTED');
    const change = sum('CHANGE_FLOAT');
    const adj = mine.find((e) => e.type === 'ADJUSTMENT') ?? null;
    const owed = collected + change + (adj?.status === 'CONFIRMED' ? adj.amount : 0);

    const payment = t.order
      ? (PAYMENT[t.order.paymentMethod] ?? t.order.paymentMethod)
      : ext
        ? ext.cash > 0 && ext.card > 0
          ? 'Наличные и картой'
          : ext.cash > 0
            ? 'Наличные'
            : ext.card > 0
              ? 'Картой, терминал'
              : 'Оплачен онлайн'
        : '—';

    return {
      id: t.id,
      number: o.number,
      status: (t.status === 'FAILED' ? 'FAILED' : 'DELIVERED') as HistoryRow['status'],
      at: (t.deliveredAt ?? t.updatedAt).toISOString(),
      address: shortAddress(o.address),
      items: t.kind === 'EXTRA_TRIP' ? `Довоз: ${t.extraReason ?? 'без причины'}` : itemsLine(o.items),
      total: t.order?.total ?? ext?.total ?? 0,
      payment,
      owed,
      cash:
        collected > 0 || change > 0
          ? { order: collected, change, paidOtherwise: adj ? { status: adj.status, paidBy: adj.paidBy } : null }
          : null,
    };
  });

  const states = cashStates(rows.map((r) => (r.cash ? r.owed : 0)), onHand);
  return rows.map(({ owed, cash, ...r }, i) => ({
    ...r,
    cash: cash ? { ...cash, owed, state: states[i] } : null,
  }));
}

// ─── Хронология смены ────────────────────────────────────────────

type TimelineEvent = {
  type: string;
  at: Date;
  meta: unknown;
  task: { order: { number: number } | null; external: unknown } | null;
};

export type TimelineRow = { at: string; kind: 'shift' | 'pause' | 'order' | 'warn'; text: string };

/** Какие события показываем курьеру и как называем */
export const TIMELINE_TYPES = [
  'CHECK_IN',
  'PAUSE_START',
  'PAUSE_END',
  'AWAY',
  'SHIFT_END',
  'ASSIGNED',
  'PICKED_UP',
  'DELIVERED',
  'FAILED',
  'PICKUP_TIMEOUT',
  'COURIER_LEFT',
] as const;

const minutesBetween = (a: Date, b: Date) => Math.max(Math.round((b.getTime() - a.getTime()) / 60_000), 0);

/**
 * Когда заступил, брал паузу, забрал и отвёз (Дом, 27.11.2026): курьер
 * видит свою смену по минутам. События — от старых к новым.
 */
export function timelineRows(events: TimelineEvent[]): TimelineRow[] {
  const picked = new Map<string, Date>();
  let onShift = false;
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const n = e.task ? `№${orderOf(e.task).number}` : '';
    const at = e.at.toISOString();
    switch (e.type) {
      case 'CHECK_IN':
        rows.push({ at, kind: 'shift', text: onShift ? 'Вернулся к раздаче, в очереди' : 'Заступил на смену' });
        onShift = true;
        break;
      case 'PAUSE_START':
        rows.push({ at, kind: 'pause', text: 'Пауза' });
        break;
      case 'PAUSE_END':
        rows.push({ at, kind: 'pause', text: 'Конец паузы' });
        break;
      case 'AWAY':
        rows.push({ at, kind: 'warn', text: 'Вне очереди' });
        break;
      case 'SHIFT_END':
        rows.push({ at, kind: 'shift', text: 'Закончил смену' });
        onShift = false;
        break;
      case 'ASSIGNED':
        rows.push({ at, kind: 'order', text: `Назначен ${n}` });
        break;
      case 'PICKED_UP':
        picked.set(n, e.at);
        rows.push({ at, kind: 'order', text: `Забрал ${n}` });
        break;
      case 'DELIVERED': {
        const from = picked.get(n);
        rows.push({ at, kind: 'order', text: `Отвёз ${n}${from ? `, в пути ${minutesBetween(from, e.at)} мин` : ''}` });
        break;
      }
      case 'FAILED':
        rows.push({ at, kind: 'warn', text: `Не доставил ${n}` });
        break;
      case 'PICKUP_TIMEOUT':
        rows.push({ at, kind: 'warn', text: `${n} передан другому: не забрал вовремя` });
        break;
      case 'COURIER_LEFT':
        rows.push({ at, kind: 'warn', text: `${n} передан другому` });
        break;
    }
  }
  return rows;
}

/** Сводка эффективности: доставки, средние минуты у раздачи и в пути, паузы */
export function shiftStats(
  tasks: { status: string; assignedAt: Date | null; pickedUpAt: Date | null; deliveredAt: Date | null }[],
  events: { type: string; at: Date }[],
  now = new Date(),
) {
  const done = tasks.filter((t) => t.status === 'DELIVERED');
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const onWay = done.filter((t) => t.pickedUpAt && t.deliveredAt).map((t) => minutesBetween(t.pickedUpAt!, t.deliveredAt!));
  const atVenue = done.filter((t) => t.assignedAt && t.pickedUpAt).map((t) => minutesBetween(t.assignedAt!, t.pickedUpAt!));
  let pauseMin = 0;
  let pauseFrom: Date | null = null;
  for (const e of events) {
    if (e.type === 'PAUSE_START') pauseFrom = e.at;
    if ((e.type === 'PAUSE_END' || e.type === 'CHECK_IN' || e.type === 'SHIFT_END') && pauseFrom) {
      pauseMin += minutesBetween(pauseFrom, e.at);
      pauseFrom = null;
    }
  }
  if (pauseFrom) pauseMin += minutesBetween(pauseFrom, now);
  return {
    delivered: done.length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
    avgOnWayMin: avg(onWay),
    avgAtVenueMin: avg(atVenue),
    pauseMin,
  };
}
