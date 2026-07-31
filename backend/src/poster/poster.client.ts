import { Injectable, Logger } from '@nestjs/common';

/**
 * Тонкий клиент Poster API (https://dev.joinposter.com).
 * Токен передаётся query-параметром `token`. Цены Poster отдаёт в сотых
 * долях (копейках/тиынах) — конвертируем в целые ₸ на границе.
 */

export interface PosterCategory {
  category_id: string;
  category_name: string;
  category_hidden: string; // "0" | "1"
  sort_order: string;
}

export interface PosterProduct {
  product_id: string;
  product_name: string;
  menu_category_id: string;
  product_production_description?: string;
  photo?: string; // относительный путь
  photo_origin?: string;
  hidden?: string; // "0" | "1" (или per-spot в spots)
  sort_order?: string;
  // цена по точкам: { "1": "255000" } — в сотых
  price?: Record<string, string>;
  spots?: Array<{ spot_id: string; price: string; visible: string }>;
  group_modifications?: unknown[];
}

const BASE_URL = 'https://joinposter.com/api';

@Injectable()
export class PosterClient {
  private readonly logger = new Logger(PosterClient.name);

  private async call<T>(
    token: string,
    method: string,
    params: Record<string, string> = {},
    httpMethod: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const qs = new URLSearchParams({ token, ...params });
    const url = `${BASE_URL}/${method}?${qs}`;
    const res = await fetch(url, {
      method: httpMethod,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Poster ${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as { response?: T; error?: unknown };
    if (json.error) {
      this.logger.error(`Poster ${method} error: ${JSON.stringify(json.error)}`);
      throw new Error(`Poster ${method} API error`);
    }
    return json.response as T;
  }

  getCategories(token: string) {
    return this.call<PosterCategory[]>(token, 'menu.getCategories');
  }

  getProducts(token: string) {
    return this.call<PosterProduct[]>(token, 'menu.getProducts');
  }

  /** Входящий заказ в кассу. service_mode: 2 — самовывоз, 3 — доставка. */
  createIncomingOrder(
    token: string,
    order: {
      spot_id: number;
      phone: string;
      service_mode: 2 | 3;
      client_address?: {
        address1: string;
        address2?: string;
        comment?: string;
        lat?: number;
        lng?: number;
      };
      comment?: string;
      products: Array<{ product_id: number; count: number; modification?: unknown }>;
      delivery_price?: number; // в сотых
      // предоплата: скидки/баллы/онлайн-оплата — в чеке Poster это
      // метод «Личная интеграция»
      payment?: { type: 0 | 1; sum: number; currency: string };
    },
  ) {
    return this.call<{ incoming_order_id: number }>(
      token,
      'incomingOrders.createIncomingOrder',
      {},
      'POST',
      order,
    );
  }

  /**
   * Статус входящего заказа. Poster: 0 — новый, 1 — принят, 7 — отклонён.
   */
  async getIncomingOrder(token: string, incomingOrderId: string) {
    return this.call<{ incoming_order_id: number; status: number }>(
      token,
      'incomingOrders.getIncomingOrder',
      { incoming_order_id: incomingOrderId },
    );
  }

  /** Цена Poster (сотые) → целые ₸ */
  static toTenge(posterPrice: string | number | undefined): number {
    if (posterPrice === undefined) return 0;
    return Math.round(Number(posterPrice) / 100);
  }

  /** Относительный путь фото → полный URL */
  static photoUrl(path: string | undefined): string | null {
    if (!path) return null;
    return path.startsWith('http') ? path : `https://joinposter.com${path}`;
  }
}
