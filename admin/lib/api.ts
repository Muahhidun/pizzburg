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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;
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
    request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
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
  sortOrder: number;
  isVisible: boolean;
  productsTotal: number;
  productsVisible: number;
  products: AdminProduct[];
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
  customer: { name: string | null; phone: string } | null;
  address: Record<string, string> | null;
  comment: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  pointsSpent: number;
  pointsEarned: number;
  total: number;
  items: {
    name: string;
    qty: number;
    price: number;
    isGift: boolean;
    modifiers: unknown;
  }[];
  parts: OrderPart[];
}

export interface OrdersResponse {
  date: string;
  total: number;
  revenue: number;
  orders: AdminOrder[];
}

export interface Promotion {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  conditionCategoryId: string;
  conditionQty: number;
  giftProductId: string;
  giftQty: number;
  repeatPerCart: boolean;
  conditionCategoryName: string;
  giftProductName: string;
}

export interface Settings {
  tenant: { id: string; slug: string; name: string };
  settings: {
    delivery?: { minOrder: number; fee: number; freeFrom: number };
    loyalty?: { cashbackPct?: number };
  };
  venues: { id: string; name: string; address: string }[];
  posterAccounts: { id: string; name: string; sortOrder: number; isActive: boolean }[];
}

export const formatTenge = (v: number) =>
  `${v.toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`;

/** Локальная календарная дата YYYY-MM-DD (не UTC — иначе ночь уезжает в соседние сутки) */
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

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
