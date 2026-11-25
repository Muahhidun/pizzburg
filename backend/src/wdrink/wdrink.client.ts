import { Injectable } from '@nestjs/common';

/**
 * Клиент кассы WDrink (DECISIONS §15). Договорённость об адресах —
 * `docs/WDRINK_INTEGRATION.md`, раздел «Договорённость между системами»;
 * тот же текст лежит в репозитории WDrink.
 *
 * Ключ — поле `token` отдела, адрес — `apiUrl`. В логи и сообщения ключ
 * не попадает: в ошибку пишем только код и текст ответа WDrink.
 */

export interface WdrinkAccount {
  token: string;
  apiUrl: string | null;
}

export interface WdrinkMenu {
  categories: { id: string; name: string; sort: number }[];
  items: {
    id: string;
    category_id: string;
    name: string;
    price: number;
    sort: number;
    available: boolean;
  }[];
}

export type WdrinkOrderStatus = 'NEW' | 'ACCEPTED' | 'SHORTAGE' | 'CANCELLED';

export interface WdrinkOrder {
  id: string;
  external_id: string;
  status: WdrinkOrderStatus;
  accepted_at: string | null;
  unavailable_item_ids: string[];
}

export class WdrinkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Статус части в тех же словах, что и у планшета Poster */
export function wdrinkPartStatus(status: WdrinkOrderStatus): string {
  // Отменённый заказ в WDrink — закрытая часть: опрос перестаёт её
  // спрашивать, как отклонённый чек Poster. Отменяем его только мы сами
  // (клиент, оператор, новый состав), поэтому отказом кухни это не считается.
  return status === 'CANCELLED' ? 'REJECTED' : status;
}

/** Дев-режим: части WDrink не уходят на настоящую кассу */
export function wdrinkDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.WDRINK_DRY_RUN ?? env.POSTER_DRY_RUN) === '1';
}

@Injectable()
export class WdrinkClient {
  private async call<T>(
    account: WdrinkAccount,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!account.apiUrl) {
      throw new WdrinkError(0, 'NO_URL', 'У отдела WDrink не указан адрес сервиса');
    }
    const res = await fetch(`${account.apiUrl.replace(/\/+$/, '')}/api/partner/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${account.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new WdrinkError(
        res.status,
        json?.error ?? `HTTP_${res.status}`,
        `WDrink ${path}: ${json?.message ?? text.slice(0, 300)}`,
      );
    }
    return json as T;
  }

  getMenu(account: WdrinkAccount) {
    return this.call<WdrinkMenu>(account, 'GET', '/menu');
  }

  createOrder(
    account: WdrinkAccount,
    body: {
      external_id: string;
      number: number;
      items: { item_id: string; qty: number; price: number }[];
      show_at?: string;
    },
  ) {
    return this.call<WdrinkOrder>(account, 'POST', '/orders', body);
  }

  getOrder(account: WdrinkAccount, externalId: string) {
    return this.call<WdrinkOrder>(account, 'GET', `/orders/${encodeURIComponent(externalId)}`);
  }

  cancelOrder(
    account: WdrinkAccount,
    externalId: string,
    reason: 'CUSTOMER' | 'REPLACED' | 'VENUE',
  ) {
    return this.call<WdrinkOrder>(
      account,
      'POST',
      `/orders/${encodeURIComponent(externalId)}/cancel`,
      { reason },
    );
  }

  status(account: WdrinkAccount) {
    return this.call<{ online: boolean; last_seen: string | null }>(account, 'GET', '/status');
  }
}
