import assert from "node:assert/strict";
import test from "node:test";
import { rootCertificates } from "node:tls";
import {
  KaspiApiError,
  KaspiConfig,
  KaspiProviderCore,
  KaspiTransport,
  loadKaspiConfig,
  parseKaspiJson,
  serializeKaspiBody,
} from "../src/payments/kaspi.provider";

const config: KaspiConfig = {
  mode: "test",
  baseUrl: new URL("https://mtokentest.kaspi.kz:8545"),
  pfx: Buffer.from("pfx"),
  passphrase: "secret",
  ca: [Buffer.from("root"), Buffer.from("intermediate")],
  organizationId: "900908350982",
  deviceToken: "device-token",
  timeoutMs: 15_000,
};

class FakeTransport implements KaspiTransport {
  calls: Array<{
    method: string;
    path: string;
    requestId: string;
    body?: Record<string, unknown>;
  }> = [];

  constructor(private readonly responses: unknown[]) {}

  async request<T>(
    method: "GET" | "POST",
    path: string,
    requestId: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ method, path, requestId, body });
    return this.responses.shift() as T;
  }
}

test("Int64 из ответа Kaspi не теряет цифры при JSON.parse", () => {
  const parsed = parseKaspiJson(
    '{"StatusCode":0,"Data":{"PaymentId":9007199254740993123,"ReturnOperationId":15}}',
  ) as any;
  assert.equal(parsed.Data.PaymentId, "9007199254740993123");
  assert.equal(parsed.Data.ReturnOperationId, "15");
});

test("QrPaymentId уходит JSON-числом без потери цифр", () => {
  assert.equal(
    serializeKaspiBody({ QrPaymentId: "9007199254740993123", Amount: 500 }),
    '{"QrPaymentId":9007199254740993123,"Amount":500}',
  );
  assert.throws(
    () => serializeKaspiBody({ QrPaymentId: "1e6" }),
    KaspiApiError,
  );
});

test("мобильная оплата использует create-link и PaymentId", async () => {
  const transport = new FakeTransport([
    {
      StatusCode: 0,
      Message: "OK",
      Data: {
        PaymentLink: "https://pay.kaspi.kz/pay/test",
        ExpireDate: "2026-09-01T12:00:00+05:00",
        PaymentId: "9007199254740993123",
        PaymentMethods: ["Gold", "Red"],
        PaymentBehaviorOptions: {
          StatusPollingInterval: 5,
          LinkActivationWaitTimeout: 180,
          PaymentConfirmationTimeout: 65,
        },
      },
    },
  ]);
  const provider = new KaspiProviderCore(config, transport);

  const result = await provider.createPayment({
    amount: 1250,
    externalId: "order:attempt",
    channel: "MOBILE_LINK",
    requestId: "request-1",
  });

  assert.equal(transport.calls[0].path, "/r3/v01/qr/create-link");
  assert.equal(transport.calls[0].body?.OrganizationBin, "900908350982");
  assert.equal(result.providerPaymentId, "9007199254740993123");
  assert.equal(result.paymentLink, "https://pay.kaspi.kz/pay/test");
  assert.equal(result.activationTimeoutSec, 180);
  assert.equal(result.confirmationTimeoutSec, 65);
});

test("web-оплата использует QR token и QrPaymentId", async () => {
  const transport = new FakeTransport([
    {
      StatusCode: 0,
      Data: {
        QrToken: "qr-token",
        ExpireDate: "2026-09-01T12:00:00+05:00",
        QrPaymentId: "123",
        PaymentMethods: ["Gold"],
        QrPaymentBehaviorOptions: {
          StatusPollingInterval: 3,
          QrCodeScanWaitTimeout: 120,
          PaymentConfirmationTimeout: 60,
        },
      },
    },
  ]);
  const provider = new KaspiProviderCore(config, transport);
  const result = await provider.createPayment({
    amount: 500,
    externalId: "order:qr",
    channel: "WEB_QR",
    requestId: "request-2",
  });
  assert.equal(transport.calls[0].path, "/r3/v01/qr/create");
  assert.equal(result.providerPaymentId, "123");
  assert.equal(result.qrToken, "qr-token");
  assert.equal(result.statusPollingIntervalSec, 3);
});

test("статусы Kaspi переводятся в внутренние статусы", async () => {
  const transport = new FakeTransport([
    { StatusCode: 0, Data: { Status: "Wait" } },
    {
      StatusCode: 0,
      Data: { Status: "Processed", TransactionId: "transaction-1" },
    },
  ]);
  const provider = new KaspiProviderCore(config, transport);
  assert.deepEqual(await provider.getPaymentStatus("123", "r1"), {
    status: "WAIT",
  });
  assert.deepEqual(await provider.getPaymentStatus("123", "r2"), {
    status: "PROCESSED",
    transactionId: "transaction-1",
  });
  assert.equal(transport.calls[0].path, "/r3/v02/payment/status/123");
});

test("возврат передаёт QrPaymentId и сохраняет ReturnOperationId", async () => {
  const transport = new FakeTransport([
    { StatusCode: 0, Data: { ReturnOperationId: "987654321" } },
  ]);
  const provider = new KaspiProviderCore(config, transport);
  const result = await provider.refundPayment({
    providerPaymentId: "123",
    amount: 700,
    requestId: "return-request",
  });
  assert.equal(transport.calls[0].path, "/r3/v01/payment/return");
  assert.equal(transport.calls[0].body?.QrPaymentId, "123");
  assert.equal(result.providerRefundId, "987654321");
});

test("постоянная ошибка Kaspi помечается как неповторяемая", async () => {
  const transport = new FakeTransport([
    { StatusCode: -99000005, Message: "Сумма возврата слишком велика" },
  ]);
  const provider = new KaspiProviderCore(config, transport);
  await assert.rejects(
    provider.refundPayment({
      providerPaymentId: "123",
      amount: 700,
      requestId: "return-request",
    }),
    (error: unknown) =>
      error instanceof KaspiApiError &&
      error.code === "-99000005" &&
      error.retryable === false,
  );
});

test("test mode не позволяет случайно обратиться к production", () => {
  const publicRoot = Buffer.from(rootCertificates[0]).toString("base64");
  const base = {
    KASPI_MODE: "test",
    KASPI_CERT_P12_BASE64: Buffer.from("pfx").toString("base64"),
    KASPI_CERT_PASSWORD: "secret",
    KASPI_ROOT_CA_BASE64: publicRoot,
    KASPI_INTERMEDIATE_CA_BASE64: publicRoot,
    KASPI_ORGANIZATION_ID: "900908350982",
    KASPI_DEVICE_TOKEN: "device",
  } as NodeJS.ProcessEnv;
  assert.throws(
    () =>
      loadKaspiConfig({
        ...base,
        KASPI_BASE_URL: "https://mtoken.kaspi.kz:8545",
      }),
    /test разрешает только/,
  );
  assert.ok(
    loadKaspiConfig({
      ...base,
      KASPI_BASE_URL: "https://mtokentest.kaspi.kz:8545",
    }),
  );
});
