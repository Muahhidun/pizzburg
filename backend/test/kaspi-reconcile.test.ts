import assert from "node:assert/strict";
import test from "node:test";
import {
  PaymentsService,
  reconcileDecision,
} from "../src/payments/payments.service";
import { PaymentProviderUnavailableError } from "../src/payments/payment-provider";
import { KaspiApiError } from "../src/payments/kaspi.provider";
import { reconcileMessage } from "../src/payments/kaspi-reconcile.service";

test("остаток совпал — всё сходится", () => {
  assert.deepEqual(
    reconcileDecision({ paid: 5000, refundedByUs: 1000, availableAtKaspi: 4000 }),
    { kind: "OK" },
  );
  // Kaspi присылает Double
  assert.deepEqual(
    reconcileDecision({ paid: 5000, refundedByUs: 0, availableAtKaspi: 5000.0 }),
    { kind: "OK" },
  );
});

test("у Kaspi остаток меньше — вернули мимо нас", () => {
  assert.deepEqual(
    reconcileDecision({ paid: 5000, refundedByUs: 1000, availableAtKaspi: 2500 }),
    { kind: "EXTERNAL", amount: 1500 },
  );
});

test("у Kaspi остаток больше — расхождение, данные не трогаем", () => {
  assert.deepEqual(
    reconcileDecision({ paid: 5000, refundedByUs: 3000, availableAtKaspi: 5000 }),
    { kind: "MISMATCH", amount: 3000 },
  );
});

function harness(attempts: any[], details: (id: string) => Promise<any>) {
  const created: any[] = [];
  const events: any[] = [];
  const orderUpdates: any[] = [];
  const prisma = {
    paymentAttempt: { findMany: async () => attempts },
    paymentRefund: {
      upsert: async ({ create }: any) => {
        created.push(create);
        return { id: `r${created.length}`, ...create };
      },
    },
    paymentEvent: { create: async ({ data }: any) => events.push(data) },
    order: {
      findUnique: async () => ({
        total: 5000,
        paymentRefunds: created.map((r) => ({ amount: r.amount, status: r.status })),
      }),
      update: async ({ data }: any) => orderUpdates.push(data),
    },
  };
  const provider = {
    getPaymentStatus: async () => ({ status: "WAIT" }),
    getPaymentDetails: details,
  };
  const service = new PaymentsService(prisma as never, {} as never, provider as never);
  return { service, created, events, orderUpdates };
}

const attempt = (over: Record<string, unknown> = {}) => ({
  id: "pa1",
  tenantId: "t1",
  orderId: "o1",
  amount: 5000,
  providerPaymentId: "501020796",
  order: { number: 42 },
  refunds: [],
  ...over,
});

test("сверка записывает возврат из Kaspi Pay и меняет статус заказа", async () => {
  const h = harness([attempt()], async () => ({
    totalAmount: 5000,
    availableReturnAmount: 0,
  }));
  const result = await h.service.reconcileKaspiPayments(new Date("2026-11-14T17:00:00Z"));
  assert.equal(result.checked, 1);
  assert.deepEqual(result.findings, [
    { tenantId: "t1", orderNumber: 42, kind: "EXTERNAL", amount: 5000 },
  ]);
  assert.equal(h.created[0].requestedBy, "KASPI_PAY");
  assert.equal(h.created[0].status, "SUCCEEDED");
  assert.equal(h.created[0].idempotencyKey, "kaspi-pay:0");
  assert.equal(h.orderUpdates[0].paymentStatus, "REFUNDED");
});

test("возврат в работе — покупку не трогаем", async () => {
  let asked = 0;
  const h = harness(
    [attempt({ refunds: [{ amount: 5000, status: "PROCESSING" }] })],
    async () => {
      asked += 1;
      return { totalAmount: 5000, availableReturnAmount: 0 };
    },
  );
  const result = await h.service.reconcileKaspiPayments();
  assert.equal(asked, 0);
  assert.equal(result.findings.length, 0);
});

test("Kaspi не ответил по одной покупке — остальные проверяем", async () => {
  let calls = 0;
  const h = harness(
    [attempt(), attempt({ id: "pa2", orderId: "o2", order: { number: 43 } })],
    async () => {
      calls += 1;
      if (calls === 1) throw new KaspiApiError("timeout", "-999", true);
      return { totalAmount: 5000, availableReturnAmount: 5000 };
    },
  );
  const result = await h.service.reconcileKaspiPayments();
  assert.equal(result.failed, 1);
  assert.equal(result.checked, 1);
  assert.equal(result.findings.length, 0);
});

test("Kaspi выключен — сверка тихо ничего не делает", async () => {
  const h = harness([attempt()], async () => {
    throw new PaymentProviderUnavailableError();
  });
  const result = await h.service.reconcileKaspiPayments();
  assert.deepEqual(result, { checked: 0, failed: 0, findings: [] });
});

test("сообщение в Telegram перечисляет заказы", () => {
  const text = reconcileMessage([
    { tenantId: "t1", orderNumber: 42, kind: "EXTERNAL", amount: 1500 },
    { tenantId: "t1", orderNumber: 43, kind: "MISMATCH", amount: 300 },
  ]);
  assert.match(text, /№42 — 1500 ₸/);
  assert.match(text, /№43 — разница 300 ₸/);
  assert.match(text, /через админку/);
});
