/**
 * Заказ плитки — наш (Order) или подтянутый из Poster (снимок в
 * `DeliveryTask.external`, см. poster-import.ts). Курьерский модуль
 * читает заказ только через `orderOf`, чтобы оба вида вели себя одинаково.
 */

export type ExternalItem = {
  id: string;
  name: string;
  qty: number;
  /** Аккаунт Poster (отдел), из которого позиция */
  posterAccountId: string | null;
};

export type ExternalOrder = {
  /** Номер для плитки: последние цифры чека Poster */
  label: string;
  createdAt: string;
  phone: string | null;
  name: string | null;
  address: {
    street?: string;
    house?: string;
    flat?: string;
    comment?: string;
    lat?: number;
    lng?: number;
  } | null;
  comment: string;
  items: ExternalItem[];
  /** Оплата из чеков Poster, ₸ */
  cash: number;
  card: number;
  total: number;
  pickup: boolean;
  refs: { accountId: string; incomingOrderId: string; transactionId: string | null }[];
};

export type ViewItem = {
  id: string;
  name: string;
  qty: number;
  modifiers: unknown;
  isGift: boolean;
  isUnavailable: boolean;
  product: { posterAccountId: string } | null;
};

export type OrderView = {
  number: string;
  createdAt: Date;
  scheduledAt: Date | null;
  address: unknown;
  phone: string | null;
  customerName: string | null;
  comment: string;
  changeFrom: number | null;
  items: ViewItem[];
  /** Подтянут из Poster (старое приложение или сайт) */
  external: boolean;
};

type OurOrder = {
  number: number;
  /** Не выбран в запросе — для расчётов по времени он нужен, для текста нет */
  createdAt?: Date;
  scheduledAt?: Date | null;
  address?: unknown;
  comment?: string;
  changeFrom?: number | null;
  customer?: { phone: string | null; name: string | null } | null;
  items?: Partial<ViewItem>[];
};

export function externalOf(raw: unknown): ExternalOrder | null {
  return raw && typeof raw === 'object' ? (raw as ExternalOrder) : null;
}

export function orderOf(t: { order?: OurOrder | null; external?: unknown }): OrderView {
  if (t.order) {
    const o = t.order;
    return {
      number: String(o.number),
      createdAt: o.createdAt ?? new Date(0),
      scheduledAt: o.scheduledAt ?? null,
      address: o.address ?? null,
      phone: o.customer?.phone ?? null,
      customerName: o.customer?.name ?? null,
      comment: o.comment ?? '',
      changeFrom: o.changeFrom ?? null,
      items: (o.items ?? []).map((i) => ({
        id: i.id ?? '',
        name: i.name ?? '',
        qty: i.qty ?? 1,
        modifiers: i.modifiers ?? [],
        isGift: i.isGift ?? false,
        isUnavailable: i.isUnavailable ?? false,
        product: i.product ?? null,
      })),
      external: false,
    };
  }
  const e = externalOf(t.external);
  return {
    number: e?.label ?? '—',
    createdAt: e ? new Date(e.createdAt) : new Date(0),
    scheduledAt: null,
    address: e?.address ?? null,
    phone: e?.phone ?? null,
    customerName: e?.name ?? null,
    comment: e?.comment ?? '',
    changeFrom: null,
    items: (e?.items ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      modifiers: [],
      isGift: false,
      isUnavailable: false,
      product: i.posterAccountId ? { posterAccountId: i.posterAccountId } : null,
    })),
    external: !!e,
  };
}

/**
 * К какому времени заказ должен уехать: предзаказ — ко времени клиента,
 * остальные — чем раньше оформлен, тем сильнее опаздывает. Готовые заказы
 * раздаются в этом порядке (Дом, 25.11.2026: «в первую очередь те, что
 * опаздывают»).
 */
export function dueAt(t: { createdAt?: Date; order?: OurOrder | null; external?: unknown }): number {
  const o = orderOf(t);
  if (o.scheduledAt) return o.scheduledAt.getTime();
  const created = o.createdAt.getTime();
  if (created > 0) return created;
  return t.createdAt ? t.createdAt.getTime() : 0;
}

/** Крайний срок доставки: предзаказ — время клиента, иначе оформление + цель */
export function deadlineAt(
  t: { createdAt?: Date; order?: OurOrder | null; external?: unknown },
  targetMin: number,
): number {
  const o = orderOf(t);
  return o.scheduledAt ? o.scheduledAt.getTime() : dueAt(t) + targetMin * 60_000;
}

/** Сначала самые опоздавшие */
export function byLateness<T extends { createdAt?: Date; order?: OurOrder | null; external?: unknown; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => dueAt(a) - dueAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const tenge = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

/**
 * Оплата заказа из Poster для курьера. У старого приложения три способа
 * (Дом, 25.11.2026): наличные — взять деньги (про сдачу пишут в
 * комментарии), «Карточкой» — картой у двери, нужен терминал,
 * «Онлайн-оплата» — уже оплачен через Kaspi.
 */
export function externalPaymentLine(e: ExternalOrder): string {
  const parts: string[] = [];
  if (e.cash > 0) parts.push(`Наличные ${tenge(e.cash)}`);
  if (e.card > 0) parts.push(`Картой ${tenge(e.card)}: возьмите терминал`);
  return parts.length ? parts.join('; ') : 'Оплачен онлайн';
}
