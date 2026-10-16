import { Injectable } from '@nestjs/common';

export type WoltDriveMode = 'test' | 'production';

export interface WoltDriveConfig {
  mode: WoltDriveMode;
  merchantKey: string;
  venueId: string;
  baseUrl: URL;
  timeoutMs: number;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface ShipmentPromiseRequest {
  street: string;
  city: string;
  post_code?: string;
  lat?: number;
  lon?: number;
  language?: string;
  min_preparation_time_minutes: number;
  parcels: Array<{ count: number; price: Money }>;
  cash?: { amount_to_collect: number };
}

export interface ShipmentPromise {
  id: string;
  valid_until: string;
  price: Money;
  is_binding: boolean;
  pickup: {
    eta_minutes?: number;
    location?: { coordinates?: { lat: number; lon: number }; formatted_address?: string };
  };
  dropoff: {
    eta_minutes?: number;
    location: { coordinates?: { lat: number; lon: number }; formatted_address?: string };
  };
}

export interface CreateDeliveryRequest {
  pickup?: { comment?: string };
  dropoff: {
    location: { coordinates?: { lat: number; lon: number } };
    comment?: string;
    options?: { is_no_contact?: boolean };
  };
  recipient: { name: string; phone_number: string; email?: string };
  parcels: Array<{
    count: number;
    description: string;
    identifier: string;
    price: Money;
  }>;
  shipment_promise_id: string;
  customer_support?: { url?: string; email?: string; phone_number?: string };
  merchant_order_reference_id: string;
  sms_notifications?: { received?: string; picked_up?: string };
  order_number?: string;
  cash?: { amount_to_collect: number; amount_to_expect?: number };
  bag_count?: number;
  language?: string;
}

export interface CreatedDelivery {
  id: string;
  status: string;
  tracking?: { id?: string; url?: string };
  wolt_order_reference_id: string;
  price?: Money;
  pickup?: { eta?: string };
  dropoff?: { eta?: string };
}

export interface CreatedWebhook {
  id: string;
  callback_url: string;
  disabled: boolean;
  subscribed_events?: string[];
}

export interface WoltDriveTransport {
  request<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T>;
}

export class WoltDriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable = status === 429 || status >= 500,
  ) {
    super(message);
    this.name = 'WoltDriveApiError';
  }
}

const TEST_ORIGIN = 'https://daas-public-api.development.dev.woltapi.com';
const PRODUCTION_ORIGIN = 'https://daas-public-api.wolt.com';

export function woltBaseUrl(mode: WoltDriveMode) {
  return new URL(mode === 'test' ? TEST_ORIGIN : PRODUCTION_ORIGIN);
}

export function assertWoltBaseUrl(mode: WoltDriveMode, baseUrl: URL) {
  const expected = mode === 'test' ? TEST_ORIGIN : PRODUCTION_ORIGIN;
  if (baseUrl.origin !== expected || baseUrl.pathname !== '/') {
    throw new Error(
      `${mode} режим Wolt Drive разрешает только ${expected}`,
    );
  }
}

export class FetchWoltDriveTransport implements WoltDriveTransport {
  constructor(private readonly config: WoltDriveConfig) {
    assertWoltBaseUrl(config.mode, config.baseUrl);
  }

  async request<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.config.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.merchantKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const message = String(payload.reason ?? payload.message ?? payload.detail ?? `HTTP ${response.status}`);
        const code = payload.error_code ? String(payload.error_code) : undefined;
        throw new WoltDriveApiError(message, response.status, code);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof WoltDriveApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WoltDriveApiError('Wolt Drive не ответил вовремя', 504, 'TIMEOUT', true);
      }
      throw new WoltDriveApiError(
        error instanceof Error ? error.message : 'Ошибка соединения с Wolt Drive',
        503,
        'NETWORK_ERROR',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Чистое ядро удобно проверять без сети подменным transport. */
export class WoltDriveProviderCore {
  constructor(
    private readonly config: WoltDriveConfig,
    private readonly transport: WoltDriveTransport,
  ) {}

  createShipmentPromise(request: ShipmentPromiseRequest) {
    return this.transport.request<ShipmentPromise>(
      'POST',
      `/v1/venues/${encodeURIComponent(this.config.venueId)}/shipment-promises`,
      request,
    );
  }

  createDelivery(request: CreateDeliveryRequest) {
    return this.transport.request<CreatedDelivery>(
      'POST',
      `/v1/venues/${encodeURIComponent(this.config.venueId)}/deliveries`,
      request,
    );
  }

  cancelDelivery(woltOrderReferenceId: string, reason: string) {
    return this.transport.request<{ status: string }>(
      'PATCH',
      `/order/${encodeURIComponent(woltOrderReferenceId)}/status/cancel`,
      { reason },
    );
  }

  createWebhook(
    merchantId: string,
    request: {
      callback_config: {
        exponential_retry_backoff: { exponent_base: number; max_retry_count: number };
      };
      callback_url: string;
      client_secret: string;
      disabled: boolean;
    },
  ) {
    return this.transport.request<CreatedWebhook>(
      'POST',
      `/v1/merchants/${encodeURIComponent(merchantId)}/webhooks`,
      request,
    );
  }
}

@Injectable()
export class WoltDriveProvider {
  forConfig(config: WoltDriveConfig) {
    assertWoltBaseUrl(config.mode, config.baseUrl);
    return new WoltDriveProviderCore(config, new FetchWoltDriveTransport(config));
  }
}
