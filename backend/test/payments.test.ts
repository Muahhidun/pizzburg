import assert from "node:assert/strict";
import test from "node:test";
import { DisabledKaspiProvider } from "../src/payments/disabled-kaspi.provider";
import {
  PAYMENT_DISPATCH_BUFFER_MS,
  PaymentsService,
  refundRetryDelayMs,
} from "../src/payments/payments.service";
import { PaymentProviderUnavailableError } from "../src/payments/payment-provider";
import { KaspiApiError } from "../src/payments/kaspi.provider";

test("пауза возврата растёт, но не превышает час", () => {
  assert.equal(refundRetryDelayMs(1), 60_000);
  assert.equal(refundRetryDelayMs(2), 120_000);
  assert.equal(refundRetryDelayMs(3), 240_000);
  assert.equal(refundRetryDelayMs(20), 60 * 60_000);
});

test("заглушка Kaspi никогда не делает вид, что платёж сработал", async () => {
  const provider = new DisabledKaspiProvider();
  await assert.rejects(
    provider.createPayment({
      amount: 100,
      externalId: "o1",
      channel: "MOBILE_LINK",
      requestId: "r1",
    }),
    PaymentProviderUnavailableError,
  );
  await assert.rejects(
    provider.refundPayment({
      providerPaymentId: "p1",
      amount: 100,
      requestId: "r2",
    }),
    PaymentProviderUnavailableError,
  );
});

test("Processed открывает минуту отмены и ещё 10 секунд до Poster", async () => {
  const orderUpdates: Record<string, unknown>[] = [];
  const attempt = {
    id: "pa1",
    orderId: "o1",
    providerPaymentId: "90071992547409930",
    status: "WAIT",
  };
  const prisma = {
    paymentAttempt: {
      findUnique: async () => attempt,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        ...attempt,
        status: "PROCESSED",
        order: { status: "NEW", tenant: { settings: {} } },
      }),
    },
    paymentEvent: { create: async () => ({}) },
    order: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        orderUpdates.push(data);
        return data;
      },
    },
  };
  const availability = {
    getState: () => ({ cancellation: { customerWindowMinutes: 1 } }),
  };
  const provider = {
    getPaymentStatus: async () => ({
      status: "PROCESSED" as const,
      transactionId: "tx1",
    }),
  };
  const service = new PaymentsService(
    prisma as never,
    availability as never,
    provider as never,
  );

  const before = Date.now();
  await service.syncPayment("pa1");
  const after = Date.now();

  assert.equal(orderUpdates.length, 1);
  assert.equal(orderUpdates[0].paymentStatus, "PAID");
  const paidAt = orderUpdates[0].paidAt as Date;
  const cancelUntil = orderUpdates[0].cancelUntil as Date;
  const dispatchAfter = orderUpdates[0].dispatchAfter as Date;
  assert.ok(paidAt.getTime() >= before && paidAt.getTime() <= after);
  assert.equal(cancelUntil.getTime() - paidAt.getTime(), 60_000);
  assert.equal(
    dispatchAfter.getTime() - cancelUntil.getTime(),
    PAYMENT_DISPATCH_BUFFER_MS,
  );
});

test("одновременный второй Processed не продлевает окно отмены", async () => {
  let orderUpdates = 0;
  const prisma = {
    paymentAttempt: {
      findUnique: async () => ({
        id: "pa-race",
        orderId: "o-race",
        providerPaymentId: "90071992547409931",
        status: "WAIT",
      }),
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => ({
        id: "pa-race",
        orderId: "o-race",
        status: "PROCESSED",
      }),
    },
    paymentEvent: { create: async () => ({}) },
    order: {
      update: async () => {
        orderUpdates += 1;
      },
    },
  };
  const service = new PaymentsService(
    prisma as never,
    {
      getState: () => ({ cancellation: { customerWindowMinutes: 1 } }),
    } as never,
    {
      getPaymentStatus: async () => ({ status: "PROCESSED" as const }),
    } as never,
  );

  await service.syncPayment("pa-race");
  assert.equal(orderUpdates, 0);
});

test("успешный полный возврат помечает заказ возвращённым", async () => {
  const refund: Record<string, any> = {
    id: "rf1",
    orderId: "o1",
    paymentAttemptId: "pa1",
    amount: 6490,
    status: "PENDING",
    attemptCount: 0,
    idempotencyKey: "order-cancel:o1",
    paymentAttempt: { providerPaymentId: "qp1" },
  };
  let orderPaymentStatus = "PAID";
  const prisma = {
    paymentRefund: {
      findUnique: async () => refund,
      findUniqueOrThrow: async () => refund,
      updateMany: async ({ data }: { data: Record<string, any> }) => {
        refund.status = data.status;
        refund.attemptCount += data.attemptCount.increment;
        refund.nextRetryAt = data.nextRetryAt;
        refund.lastError = data.lastError;
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(refund, data);
        return { ...refund };
      },
    },
    paymentEvent: { create: async () => ({}) },
    order: {
      findUnique: async () => ({ total: 6490, paymentRefunds: [refund] }),
      update: async ({ data }: { data: { paymentStatus: string } }) => {
        orderPaymentStatus = data.paymentStatus;
        return data;
      },
    },
  };
  const provider = {
    refundPayment: async () => ({ providerRefundId: "return-1" }),
  };
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    provider as never,
  );

  const result = await service.processRefund("rf1");

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.providerRefundId, "return-1");
  assert.equal(orderPaymentStatus, "REFUNDED");
});

test("временный сбой возврата остаётся видимым и получает срок повтора", async () => {
  const refund: Record<string, any> = {
    id: "rf1",
    orderId: "o1",
    paymentAttemptId: "pa1",
    amount: 6490,
    status: "PENDING",
    attemptCount: 0,
    idempotencyKey: "order-cancel:o1",
    paymentAttempt: { providerPaymentId: "qp1" },
  };
  let orderPaymentStatus = "PAID";
  const prisma = {
    paymentRefund: {
      findUnique: async () => refund,
      findUniqueOrThrow: async () => refund,
      updateMany: async ({ data }: { data: Record<string, any> }) => {
        refund.status = data.status;
        refund.attemptCount += data.attemptCount.increment;
        refund.nextRetryAt = data.nextRetryAt;
        refund.lastError = data.lastError;
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(refund, data);
        return { ...refund };
      },
    },
    paymentEvent: { create: async () => ({}) },
    order: {
      findUnique: async () => ({ total: 6490, paymentRefunds: [refund] }),
      update: async ({ data }: { data: { paymentStatus: string } }) => {
        orderPaymentStatus = data.paymentStatus;
        return data;
      },
    },
  };
  const provider = {
    refundPayment: async () => {
      throw new Error("Kaspi временно недоступен");
    },
  };
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    provider as never,
  );

  const before = Date.now();
  const result = await service.processRefund("rf1");

  assert.equal(result.status, "RETRY_PENDING");
  assert.equal(result.attemptCount, 1);
  assert.match(result.lastError, /временно недоступен/);
  assert.ok(result.nextRetryAt.getTime() >= before + 60_000);
  assert.equal(orderPaymentStatus, "REFUND_PENDING");
});

test("постоянная ошибка возврата не повторяется автоматически", async () => {
  const refund: Record<string, any> = {
    id: "rf-permanent",
    orderId: "o1",
    paymentAttemptId: "pa1",
    amount: 6490,
    status: "PENDING",
    attemptCount: 0,
    paymentAttempt: { providerPaymentId: "123" },
  };
  const prisma = {
    paymentRefund: {
      findUnique: async () => refund,
      findUniqueOrThrow: async () => refund,
      updateMany: async ({ data }: { data: Record<string, any> }) => {
        refund.status = data.status;
        refund.attemptCount += data.attemptCount.increment;
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(refund, data);
        return { ...refund };
      },
    },
    paymentEvent: { create: async () => ({}) },
    order: {
      findUnique: async () => ({ total: 6490, paymentRefunds: [refund] }),
      update: async () => ({}),
    },
  };
  const provider = {
    refundPayment: async () => {
      throw new KaspiApiError(
        "Сумма возврата превышает покупку",
        "-99000005",
        false,
      );
    },
  };
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    provider as never,
  );

  const result = await service.processRefund("rf-permanent");

  assert.equal(result.status, "FAILED");
  assert.equal(result.nextRetryAt, null);
  assert.equal(result.attemptCount, 1);
});

test("два контейнера не отправляют один возврат дважды", async () => {
  let providerCalls = 0;
  const refund = {
    id: "rf1",
    orderId: "o1",
    paymentAttemptId: "pa1",
    amount: 6490,
    status: "PENDING",
    attemptCount: 0,
    idempotencyKey: "order-cancel:o1",
    paymentAttempt: { providerPaymentId: "qp1" },
  };
  const prisma = {
    paymentRefund: {
      findUnique: async () => refund,
      // Другой контейнер успел атомарно сменить PENDING на PROCESSING.
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => ({ ...refund, status: "PROCESSING" }),
    },
  };
  const provider = {
    refundPayment: async () => {
      providerCalls++;
      return { providerRefundId: "should-not-happen" };
    },
  };
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    provider as never,
  );

  const result = await service.processRefund("rf1");

  assert.equal(result.status, "PROCESSING");
  assert.equal(providerCalls, 0);
});
