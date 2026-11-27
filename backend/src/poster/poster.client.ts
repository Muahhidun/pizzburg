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
      const details = (await res.text()).slice(0, 2000);
      throw new Error(
        `Poster ${method} HTTP ${res.status}` +
          (details ? `: ${details}` : ''),
      );
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

  /**
   * Техкарта блюда: состав с ингредиентами.
   *
   * Poster отдаёт её только поштучно, `menu.getProducts` состава не
   * содержит — там лежит `product_production_description`, и у PizzBurg
   * оно заполнено у восьми позиций из ста девяноста девяти.
   *
   * Возвращаем сырой ответ: структура у Poster разная для товара,
   * блюда и техкарты, и разбирать её лучше по факту, а не по догадке.
   */
  getProductRaw(token: string, productId: string) {
    return this.call<Record<string, unknown>>(token, 'menu.getProduct', {
      product_id: productId,
    });
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

  /**
   * Входящие (онлайн) заказы за день — для подтягивания на планшет раздачи
   * заказов, пришедших мимо нас (старое приложение, старый сайт).
   * Ответ разбираем по факту (poster-import.ts): поля у источников разные.
   */
  /** Онлайн-заказы с `from` по `date` включительно (по умолчанию за один день) */
  getIncomingOrders(token: string, date: string, from = date) {
    // Poster ждёт дату со временем («Y-m-d H:i:s»). Голая дата в обоих
    // полях — это промежуток 00:00–00:00, и ответ всегда пустой
    // (так было 25.11.2026). timezone=client — время по часам заведения.
    return this.call<Record<string, unknown>[]>(token, 'incomingOrders.getIncomingOrders', {
      date_from: `${from} 00:00:00`,
      date_to: `${date} 23:59:59`,
      timezone: 'client',
    });
  }

  /** Чек: оплата (наличные, карта) и данные доставки */
  getTransaction(token: string, transactionId: string) {
    return this.call<Record<string, unknown> | Record<string, unknown>[]>(
      token,
      'dash.getTransaction',
      { transaction_id: transactionId, include_delivery: 'true' },
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
