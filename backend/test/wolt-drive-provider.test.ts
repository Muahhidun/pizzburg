import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  WoltDriveConfig,
  WoltDriveProviderCore,
  WoltDriveTransport,
  assertWoltBaseUrl,
  woltBaseUrl,
} from '../src/wolt-drive/wolt-drive.provider';
import {
  assertWoltQuoteWithinLimit,
  tengeToMinor,
  woltDeliveryPriceLimitTenge,
  woltDropoffComment,
  woltStreet,
} from '../src/wolt-drive/wolt-drive.service';
import {
  nextWoltDeliveryStatus,
  verifyWoltWebhookToken,
} from '../src/wolt-drive/wolt-drive.webhook';

const config: WoltDriveConfig = {
  mode: 'test',
  merchantKey: 'development-key',
  venueId: 'venue/with spaces',
  baseUrl: woltBaseUrl('test'),
  timeoutMs: 15_000,
};

class FakeTransport implements WoltDriveTransport {
  calls: Array<{ method: string; path: string; body: unknown }> = [];
  constructor(private readonly responses: unknown[]) {}
  async request<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    return this.responses.shift() as T;
  }
}

test('тестовый режим не может уйти на production Wolt', () => {
  assert.doesNotThrow(() => assertWoltBaseUrl('test', woltBaseUrl('test')));
  assert.throws(
    () => assertWoltBaseUrl('test', woltBaseUrl('production')),
    /разрешает только/,
  );
});

test('расчёт и вызов используют Venue ID и binding promise', async () => {
  const transport = new FakeTransport([
    {
      id: 'promise-1', valid_until: '2026-09-04T12:00:00Z',
      price: { amount: 98400, currency: 'KZT' }, is_binding: true,
      pickup: { eta_minutes: 20 }, dropoff: { eta_minutes: 32, location: {} },
    },
    { status: 'INFO_RECEIVED', wolt_order_reference_id: 'wolt-1' },
  ]);
  const provider = new WoltDriveProviderCore(config, transport);
  const promise = await provider.createShipmentPromise({
    street: 'Сатпаева, 38А', city: 'Ekibastuz',
    min_preparation_time_minutes: 25,
    parcels: [{ count: 1, price: { amount: 300100, currency: 'KZT' } }],
  });
  await provider.createDelivery({
    dropoff: { location: {} }, recipient: { name: 'Клиент', phone_number: '+77000000000' },
    parcels: [{ count: 1, description: 'Заказ', identifier: 'order-1', price: { amount: 300100, currency: 'KZT' } }],
    shipment_promise_id: promise.id, merchant_order_reference_id: 'tenant:order-1',
  });
  assert.equal(transport.calls[0].path, '/v1/venues/venue%2Fwith%20spaces/shipment-promises');
  assert.equal(transport.calls[1].path, '/v1/venues/venue%2Fwith%20spaces/deliveries');
  assert.equal((transport.calls[1].body as any).shipment_promise_id, 'promise-1');
});

test('отмена передаёт причину и ссылку на заказ Wolt', async () => {
  const transport = new FakeTransport([{ status: 'CANCELLED' }]);
  const provider = new WoltDriveProviderCore(config, transport);
  await provider.cancelDelivery('wolt/order 1', 'Нашли своего курьера');
  assert.deepEqual(transport.calls[0], {
    method: 'PATCH',
    path: '/order/wolt%2Forder%201/status/cancel',
    body: { reason: 'Нашли своего курьера' },
  });
});

test('адрес, комментарий и сумма готовятся без потери данных', () => {
  assert.equal(woltStreet({ street: 'Сатпаева', house: '38А' }), 'Сатпаева, 38А');
  assert.equal(
    woltDropoffComment({ entrance: '2', floor: '5', flat: '31', comment: 'домофон 31' }, 'без звонка'),
    'подъезд 2; этаж 5; кв. 31; домофон 31; без звонка',
  );
  assert.equal(tengeToMinor(3001), 300100);
});

test('лимит Wolt ступенчато зависит от итоговой суммы заказа', () => {
  assert.equal(woltDeliveryPriceLimitTenge(5_999), 1_200);
  assert.equal(woltDeliveryPriceLimitTenge(6_000), 1_500);
  assert.equal(woltDeliveryPriceLimitTenge(7_999), 1_500);
  assert.equal(woltDeliveryPriceLimitTenge(8_000), 2_000);

  assert.doesNotThrow(() => assertWoltQuoteWithinLimit(120000, 'KZT', 5_999));
  assert.doesNotThrow(() => assertWoltQuoteWithinLimit(150000, 'KZT', 6_000));
  assert.doesNotThrow(() => assertWoltQuoteWithinLimit(200000, 'KZT', 8_000));
  assert.throws(
    () => assertWoltQuoteWithinLimit(120001, 'KZT', 5_999),
    /превышает лимит 1 200 ₸/,
  );
  assert.throws(
    () => assertWoltQuoteWithinLimit(150001, 'KZT', 7_999),
    /превышает лимит 1 500 ₸/,
  );
  assert.throws(
    () => assertWoltQuoteWithinLimit(200001, 'KZT', 8_000),
    /превышает лимит 2 000 ₸/,
  );
  assert.throws(
    () => assertWoltQuoteWithinLimit(1000, 'USD', 8_000),
    /неожиданную валюту/,
  );
});

test('webhook регистрируется на Merchant ID с безопасными повторами', async () => {
  const transport = new FakeTransport([{ id: 'hook-1', callback_url: 'https://api.example.kz/wolt-drive/webhooks', disabled: false }]);
  const provider = new WoltDriveProviderCore(config, transport);
  await provider.createWebhook('merchant/with spaces', {
    callback_config: { exponential_retry_backoff: { exponent_base: 5, max_retry_count: 3 } },
    callback_url: 'https://api.example.kz/wolt-drive/webhooks',
    client_secret: 'secret',
    disabled: false,
  });
  assert.equal(transport.calls[0].path, '/v1/merchants/merchant%2Fwith%20spaces/webhooks');
});

test('webhook принимает только HS256 с правильной подписью', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    dispatched_at: '2026-09-04T12:00:00.000Z',
    type: 'order.picked_up',
    details: { id: 'event-1', venue_id: 'venue-1' },
  })).toString('base64url');
  const secret = 'local-webhook-secret';
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const token = `${header}.${body}.${signature}`;

  assert.equal(verifyWoltWebhookToken(token, secret).details.id, 'event-1');
  assert.throws(() => verifyWoltWebhookToken(token, 'wrong-secret'), /signature/);
});

test('запоздалый webhook не откатывает статус доставки назад', () => {
  assert.equal(nextWoltDeliveryStatus('PICKED_UP', 'order.received'), 'PICKED_UP');
  assert.equal(nextWoltDeliveryStatus('PICKED_UP', 'order.dropoff_started'), 'DROPOFF_STARTED');
  assert.equal(nextWoltDeliveryStatus('DELIVERED', 'order.dropoff_completed'), 'DELIVERED');
});
