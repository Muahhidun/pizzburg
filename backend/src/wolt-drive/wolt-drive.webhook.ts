import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WoltWebhookPayload {
  dispatched_at: string;
  type: string;
  details: {
    id: string;
    venue_id?: string;
    wolt_order_reference_id?: string;
    merchant_order_reference_id?: string | null;
    order_number?: string | null;
    pickup?: { eta?: string | null } | null;
    dropoff?: {
      eta?: { min?: string | null; max?: string | null } | null;
      completed_at?: string | null;
    } | null;
    courier?: { vehicle_type?: string | null } | null;
    purchase_rejected_reason?: string | null;
    pin_code?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function parsePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

/**
 * Декодирование используется только для поиска tenant-specific secret.
 * Доверять payload можно исключительно после verifyWoltWebhookToken.
 */
export function decodeUnverifiedWoltWebhookToken(token: string): WoltWebhookPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed webhook token');
  return parsePart<WoltWebhookPayload>(parts[1]);
}

export function verifyWoltWebhookToken(token: string, secret: string): WoltWebhookPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed webhook token');
  const header = parsePart<{ alg?: string; typ?: string }>(parts[0]);
  if (header.alg !== 'HS256') throw new Error('Unsupported webhook algorithm');

  const actual = Buffer.from(parts[2], 'base64url');
  const expected = createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid webhook signature');
  }

  const payload = parsePart<WoltWebhookPayload>(parts[1]);
  if (
    !payload ||
    typeof payload.type !== 'string' ||
    typeof payload.dispatched_at !== 'string' ||
    !payload.details ||
    typeof payload.details.id !== 'string'
  ) {
    throw new Error('Invalid webhook payload');
  }
  return payload;
}

const EVENT_STATUS: Record<string, string> = {
  'order.received': 'RECEIVED',
  'order.rejected': 'REJECTED',
  'order.pickup_arrival': 'PICKUP_STARTED',
  'order.pickup_started': 'PICKUP_STARTED',
  'order.picked_up': 'PICKED_UP',
  'order.dropoff_arrival': 'DROPOFF_STARTED',
  'order.dropoff_started': 'DROPOFF_STARTED',
  'order.dropoff_completed': 'DELIVERED',
  'order.delivered': 'DELIVERED',
  'order.customer_no_show': 'CUSTOMER_NO_SHOW',
};

const STATUS_RANK: Record<string, number> = {
  QUOTED: 0,
  REQUESTING: 1,
  INFO_RECEIVED: 2,
  RECEIVED: 2,
  PICKUP_STARTED: 3,
  PICKED_UP: 4,
  DROPOFF_STARTED: 5,
  DELIVERED: 6,
  CUSTOMER_NO_SHOW: 6,
  REJECTED: 6,
  CANCELLED: 6,
};

/** Wolt предупреждает, что связанные события могут приходить не по порядку. */
export function nextWoltDeliveryStatus(current: string, eventType: string) {
  const candidate = EVENT_STATUS[eventType];
  if (!candidate) return current;
  return (STATUS_RANK[candidate] ?? 0) >= (STATUS_RANK[current] ?? 0)
    ? candidate
    : current;
}
