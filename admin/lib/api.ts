'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3210';
const TOKEN_KEY = 'pizzburg_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export interface AdminProfile {
  id: string | null;
  tenantId?: string;
  username: string;
  displayName: string;
  role: 'OWNER' | 'CASHIER';
  isActive?: boolean;
  legacy: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export async function loginAdmin(username: string, password: string) {
  const res = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Не удалось войти');
  return body as { token: string; user: AdminProfile };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      'X-Admin-Token': getToken() ?? '',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Не авторизован');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Ошибка ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  patch: <T>(p: string, body: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(p: string, body: unknown) =>
    request<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  upload: <T>(p: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(p, { method: 'POST', body: form });
  },
  raw: BASE,
};

// ─── Типы ответов ───────────────────────────────────────────────────

export interface AdminProduct {
  id: string;
  name: string;
  displayName: string | null;
  description: string;
  displayDescription: string | null;
  photoUrl: string | null;
  displayPhotoUrl: string | null;
  weightLabel: string | null;
  displayNameKk: string | null;
  displayDescriptionKk: string | null;
  weightLabelKk: string | null;
  isHit: boolean;
  isSpicy: boolean;
  isNew: boolean;
  price: number;
  priceOverride: number | null;
  isVisible: boolean;
  inStopList: boolean;
  department: string;
  posterCategory: string;
  hasModifiers: boolean;
}

export interface AdminCategory {
  id: string;
  name: string;
  nameKk: string | null;
  sortOrder: number;
  isVisible: boolean;
  productsTotal: number;
  productsVisible: number;
  products: AdminProduct[];
}

/** Отзыв о заказе (DECISIONS §12.23) */
export interface AdminReview {
  id: string;
  rating: number;
  answers: Record<string, string>;
  text: string;
  alerted: boolean;
  createdAt: string;
  answeredAt: string | null;
  answeredBy: string | null;
  answerText: string | null;
  orderNumber: number;
  orderType: 'DELIVERY' | 'PICKUP';
  orderTotal: number;
  customerName: string | null;
  customerPhone: string | null;
}

export interface ReviewsReport {
  from: string;
  to: string;
  total: number;
  averageRating: number;
  questions: {
    id: string;
    label: string;
    answered: number;
    worstPct: number;
    options: { id: string; label: string; count: number; worst: boolean }[];
  }[];
  items: AdminReview[];
}

/** Обращение по живому заказу (DECISIONS §12.21) */
export interface AdminOrderMessage {
  id: string;
  topic: string;
  label: string;
  text: string;
  createdAt: string;
  answeredAt: string | null;
  answeredBy: string | null;
  answerText: string | null;
  orderNumber: number;
  orderStatus: string;
  customerName: string | null;
  customerPhone: string | null;
}

export interface MessagesReport {
  from: string;
  to: string;
  total: number;
  topics: Record<string, string>;
  byTopic: Record<string, number>;
  items: AdminOrderMessage[];
}

/** Позиция допродажи (DECISIONS §12.20) */
export interface UpsellItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  photoUrl: string | null;
  /** null — предлагаем к любому заказу */
  appCategoryId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Storefront {
  tenantId: string;
  categories: AdminCategory[];
}

export interface OrderPart {
  department: string;
  status: string;
  posterStatus: string | null;
  posterOrderId: string | null;
  error: string | null;
}

export interface AdminOrder {
  id: string;
  number: number;
  createdAt: string;
  scheduledAt: string | null;
  type: 'DELIVERY' | 'PICKUP';
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paidAt: string | null;
  cancelUntil: string | null;
  payment: {
    id: string;
    status: string;
    amount: number;
    processedAt: string | null;
    errorMessage: string | null;
    refunds: {
      id: string;
      amount: number;
      status: string;
      attemptCount: number;
      nextRetryAt: string | null;
      lastError: string | null;
      completedAt: string | null;
    }[];
  } | null;
  customer: { name: string | null; phone: string } | null;
  address: Record<string, string> | null;
  comment: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  pointsSpent: number;
  pointsEarned: number;
  total: number;
  /// Другие живые заказы того же клиента — признак перезаказа
  otherActiveOrders: number[];
  items: {
    name: string;
    qty: number;
    price: number;
    isGift: boolean;
    modifiers: unknown;
  }[];
  parts: OrderPart[];
}

/**
 * Разбирательство по нехватке позиции (DECISIONS §12.9).
 *
 * Живёт отдельно от статуса заказа: основной отдел готовит свою часть,
 * не дожидаясь ответа клиента, поэтому заказ может быть одновременно
 * принятым и ждущим выбора по позиции второго отдела.
 */
export type ShortageState =
  | 'NONE'
  | 'AWAITING_CUSTOMER'
  | 'KEPT_REST'
  | 'CANCELLED_BY_CUSTOMER';

export interface CashierItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  isGift: boolean;
  isUnavailable: boolean;
  department: string;
}

export interface CashierPart extends OrderPart {
  /// Отменённые чеки этой части: Poster не умеет менять состав, и
  /// исправленный заказ уходит новым чеком
  replacedOrders: { posterOrderId: string; replacedAt: string }[];
}

export interface CashierOrder {
  id: string;
  number: number;
  createdAt: string;
  scheduledAt: string | null;
  type: 'DELIVERY' | 'PICKUP';
  status: string;
  paymentMethod: string;
  customer: { name: string | null; phone: string } | null;
  comment: string;
  total: number;
  shortageState: ShortageState;
  shortageDeadline: string | null;
  shortageResolvedBy: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  /// У отменённого заказа — чеки, которые ещё висят на планшетах.
  /// Пустеет само, когда кассир их отклонит.
  receiptsToReject: { department: string; posterOrderId: string }[];
  /// Другие живые заказы того же клиента — признак перезаказа.
  /// Только сигнал: ничего не отменяется автоматически.
  otherActiveOrders: number[];
  items: CashierItem[];
  parts: CashierPart[];
}

export interface CashierQueue {
  /// Сколько минут ждём ответа клиента — считает сервер
  windowMinutes: number;
  orders: CashierOrder[];
}

/** Срок стопа: бессрочного стопа у нас нет (DECISIONS §12.3) */
export type StopPreset = 'HOUR' | 'TWO_HOURS' | 'END_OF_DAY' | 'NEXT_SHIFT';

export interface StoppedProduct {
  id: string;
  name: string;
  category: string;
  department: string;
  until: string;
  reason: string | null;
}

export interface StoppedCategory {
  id: string;
  name: string;
  until: string;
  reason: string | null;
}

export interface StopListResponse {
  presets: { value: StopPreset; label: string }[];
  products: StoppedProduct[];
  categories: StoppedCategory[];
}

/** Настройки телеграм-канала. Токен наружу не отдаётся */
export interface TelegramSettings {
  enabled: boolean;
  /// Чат руководства
  chatId: string;
  /// Чат кассы — отдельный: разные аудитории и разные события
  cashierChatId: string;
  botTokenSet: boolean;
  botTokenHint: string;
}

/**
 * Причина отмены из справочника. `availableToCustomer` отделяет причины,
 * которые видит клиент, от внутренних («нет курьеров», «нет позиции»).
 */
export interface AdminCancelReason {
  id: string;
  label: string;
  labelKk: string | null;
  isActive: boolean;
  availableToCustomer: boolean;
  sortOrder: number;
}

export interface OrdersResponse {
  date: string;
  total: number;
  revenue: number;
  orders: AdminOrder[];
}

/** Тип акции определяет, какие поля условия и эффекта имеют смысл */
export type PromotionKind =
  | 'GIFT_FOR_QTY'
  | 'GIFT_FOR_SUM'
  | 'PERCENT_OFF'
  | 'FIXED_OFF'
  | 'FREE_DELIVERY';

export const PROMOTION_KINDS: { value: PromotionKind; label: string; hint: string }[] = [
  {
    value: 'GIFT_FOR_QTY',
    label: 'N товаров → подарок',
    hint: 'Классическая «2+1»: сколько-то позиций из категории дают подарок',
  },
  {
    value: 'GIFT_FOR_SUM',
    label: 'Сумма → подарок',
    hint: 'Заказ от указанной суммы даёт подарок',
  },
  {
    value: 'PERCENT_OFF',
    label: 'Скидка %',
    hint: 'Процент от суммы товаров. Ставьте потолок, иначе крупный заказ съест выручку',
  },
  { value: 'FIXED_OFF', label: 'Скидка ₸', hint: 'Фиксированная сумма скидки' },
  {
    value: 'FREE_DELIVERY',
    label: 'Бесплатная доставка',
    hint: 'Обнуляет стоимость доставки; на самовывозе не применяется',
  },
];

export interface Promotion {
  id: string;
  name: string;
  kind: PromotionKind;
  code: string | null;
  isActive: boolean;
  conditionCategoryId: string | null;
  conditionQty: number;
  minOrderSum: number | null;
  giftProductId: string | null;
  giftQty: number;
  discountValue: number;
  maxDiscount: number | null;
  repeatPerCart: boolean;
  firstOrderOnly: boolean;
  perCustomerLimit: number | null;
  totalLimit: number | null;
  orderType: 'DELIVERY' | 'PICKUP' | null;
  conditionCategoryName: string;
  giftProductName: string;
}

export type OrderingMode = 'ALL' | 'PICKUP_ONLY' | 'CLOSED';
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface ScheduleProfile {
  id: string;
  name: string;
  activeFrom?: string | null;
  activeTo?: string | null;
  hours: Partial<Record<WeekdayKey, [string, string][]>>;
}

export interface PreorderSettings {
  enabled: boolean;
  deliveryLeadMinutes: number;
  pickupLeadMinutes: number;
  slotStepMinutes: number;
  displayPaddingMinutes: number;
  closeAsapBeforeMinutes: number;
  maxDaysAhead: number;
}

export interface PaymentSettings {
  cash: boolean;
  cardOnDelivery: boolean;
  kaspiOnline: boolean;
  askChangeFrom: boolean;
}

/** Что клиент видит прямо сейчас — считает сервер */
export interface AvailabilityNow {
  timezone: string;
  mode: OrderingMode;
  orderingUntil: string | null;
  isOpenNow: boolean;
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  asapAvailable: boolean;
  message: string | null;
  scheduleProfile: string | null;
  todayHours: [string, string][];
  preorder: PreorderSettings;
  payments: PaymentSettings;
  cancellation: { customerWindowMinutes: number };
  rushExtraMinutes: number;
  rushUntil: string | null;
  rushNotice: string | null;
}

export interface Settings {
  tenant: { id: string; slug: string; name: string };
  settings: {
    timezone?: string;
    delivery?: { minOrder: number; fee: number; freeFrom: number };
    loyalty?: {
      cashbackPct?: number;
      earnWhenPointsSpent?: boolean;
      allowPointsWithPromotions?: boolean;
      earnOnPromotionalOrders?: boolean;
      /// Доля стоимости товаров, которую можно закрыть баллами, %
      maxSpendPct?: number;
    };
    ordering?: {
      mode?: OrderingMode;
      until?: string | null;
      closedMessage?: string;
      pickupOnlyMessage?: string;
    };
    schedule?: { profiles?: ScheduleProfile[] };
    preorder?: Partial<PreorderSettings>;
    payments?: Partial<PaymentSettings>;
    cancellation?: { customerWindowMinutes?: number };
  };
  venues: { id: string; name: string; address: string }[];
  posterAccounts: {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
  }[];
  availabilityNow: AvailabilityNow;
}

export const WEEKDAY_LABELS: { key: WeekdayKey; label: string }[] = [
  { key: 'mon', label: 'Понедельник' },
  { key: 'tue', label: 'Вторник' },
  { key: 'wed', label: 'Среда' },
  { key: 'thu', label: 'Четверг' },
  { key: 'fri', label: 'Пятница' },
  { key: 'sat', label: 'Суббота' },
  { key: 'sun', label: 'Воскресенье' },
];

export const formatTenge = (v: number) => `${v.toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`;

/** Локальная календарная дата YYYY-MM-DD (не UTC — иначе ночь уезжает в соседние сутки) */
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

/** Адрес городского справочника */
export interface CityAddress {
  id: string;
  street: string;
  house: string;
  lat: number | null;
  lng: number | null;
  isDeliverable: boolean;
  /// OSM — пришёл импортом, MANUAL — завёл оператор
  source: string;
}

export interface AddressesResponse {
  items: CityAddress[];
  total: number;
  page: number;
  pages: number;
  totalAll: number;
  undeliverable: number;
}

/** Заявка «моего адреса нет в списке» */
export interface AddressRequestRow {
  id: string;
  raw: string;
  phone: string | null;
  createdAt: string;
  resolvedAt: string | null;
  customer: { name: string | null; phone: string } | null;
}

/** Ступень лестницы кэшбэка */
export interface LoyaltyLevel {
  level: number;
  name: string;
  cashbackPct: number;
  minSpent: number;
}

export interface LoyaltyLevelsResponse {
  levels: LoyaltyLevel[];
  defaults: LoyaltyLevel[];
  /// Плоский процент из старых настроек: пока он задан, лестница не работает
  flatCashbackPct: number | null;
}

export interface CustomerRow {
  id: string;
  name: string | null;
  phone: string;
  pointsBalance: number;
  loyaltyLevel: number;
  ordersCount: number;
  totalSpent: number;
  averageCheck: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface CustomersResponse {
  total: number;
  page: number;
  pages: number;
  customers: CustomerRow[];
}
