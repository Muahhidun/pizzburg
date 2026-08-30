-- ExtendEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_FAILED';

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('KASPI');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MOBILE_LINK', 'WEB_QR');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM (
    'CREATED',
    'QR_TOKEN_CREATED',
    'WAIT',
    'PROCESSED',
    'ERROR',
    'EXPIRED'
);

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'RETRY_PENDING',
    'SUCCEEDED',
    'FAILED'
);

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "cancelUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'KASPI',
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "externalId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "providerTransactionId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "statusPollingIntervalSec" INTEGER,
    "activationTimeoutSec" INTEGER,
    "confirmationTimeoutSec" INTEGER,
    "paymentMethods" JSONB NOT NULL DEFAULT '[]',
    "processedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "refundId" TEXT,
    "kind" TEXT NOT NULL,
    "requestId" TEXT,
    "providerStatus" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_cancelUntil_idx" ON "Order"("cancelUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_externalId_key"
ON "PaymentAttempt"("provider", "externalId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_status_idx"
ON "PaymentAttempt"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_tenantId_status_idx"
ON "PaymentAttempt"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerPaymentId_idx"
ON "PaymentAttempt"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_paymentAttemptId_idempotencyKey_key"
ON "PaymentRefund"("paymentAttemptId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentRefund_orderId_status_idx"
ON "PaymentRefund"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_tenantId_status_idx"
ON "PaymentRefund"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_status_nextRetryAt_idx"
ON "PaymentRefund"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentAttemptId_createdAt_idx"
ON "PaymentEvent"("paymentAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_refundId_createdAt_idx"
ON "PaymentEvent"("refundId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_requestId_idx" ON "PaymentEvent"("requestId");

-- AddForeignKey
ALTER TABLE "PaymentAttempt"
ADD CONSTRAINT "PaymentAttempt_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt"
ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund"
ADD CONSTRAINT "PaymentRefund_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund"
ADD CONSTRAINT "PaymentRefund_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund"
ADD CONSTRAINT "PaymentRefund_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
