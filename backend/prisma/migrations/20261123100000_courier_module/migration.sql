-- Курьерский модуль, этап 7.1 (docs/COURIER_SYSTEM_SPEC.md, DECISIONS §14).
-- Только новые таблицы и типы: существующие данные и Order.status не меняются.

-- CreateEnum
CREATE TYPE "CourierStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CourierQueueState" AS ENUM ('WAITING', 'ASSIGNED', 'ON_DELIVERY', 'RETURNING', 'ON_PAUSE', 'AWAY');

-- CreateEnum
CREATE TYPE "DeliveryTaskKind" AS ENUM ('DELIVERY', 'PICKUP', 'EXTRA_TRIP');

-- CreateEnum
CREATE TYPE "DeliveryTaskStatus" AS ENUM ('NEW', 'READY', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'HANDED_OVER', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupMethod" AS ENUM ('SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "HandoffMethod" AS ENUM ('BUTTON', 'CODE', 'NO_CODE');

-- CreateEnum
CREATE TYPE "CourierCashType" AS ENUM ('COLLECTED', 'HANDED_IN', 'PAYOUT_OFFSET', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CourierCashStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CourierSettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CourierPayoutType" AS ENUM ('DELIVERY', 'EXTRA_TRIP', 'FAILED_TRIP', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Courier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "selfieFileId" TEXT,
    "status" "CourierStatus" NOT NULL DEFAULT 'DRAFT',
    "registrationStep" TEXT,
    "consentAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "completedShifts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "state" "CourierQueueState" NOT NULL DEFAULT 'WAITING',
    "queuedAt" TIMESTAMP(3),
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "pauseUntil" TIMESTAMP(3),
    "pausesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "DeliveryTaskKind" NOT NULL,
    "status" "DeliveryTaskStatus" NOT NULL DEFAULT 'NEW',
    "readyAt" TIMESTAMP(3),
    "courierId" TEXT,
    "shiftId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "pickupMethod" "PickupMethod",
    "deliveredAt" TIMESTAMP(3),
    "handoffMethod" "HandoffMethod",
    "handoffLat" DOUBLE PRECISION,
    "handoffLng" DOUBLE PRECISION,
    "failedReason" TEXT,
    "batchId" TEXT,
    "batchSeq" INTEGER,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cashToCollect" INTEGER NOT NULL DEFAULT 0,
    "needsTerminal" BOOLEAN NOT NULL DEFAULT false,
    "extraReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryTaskEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT,
    "shiftId" TEXT,
    "courierId" TEXT,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "meta" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierCashEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" "CourierCashType" NOT NULL,
    "status" "CourierCashStatus" NOT NULL DEFAULT 'CONFIRMED',
    "amount" INTEGER NOT NULL,
    "claimedAmount" INTEGER,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "cardChatId" TEXT,
    "cardMessageId" INTEGER,
    "promptMessageId" INTEGER,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierCashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "shiftId" TEXT,
    "earned" INTEGER NOT NULL,
    "cashHeld" INTEGER NOT NULL,
    "courierPays" INTEGER NOT NULL,
    "venuePays" INTEGER NOT NULL,
    "deliveries" INTEGER NOT NULL,
    "status" "CourierSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "cardChatId" TEXT,
    "cardMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierPayoutLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "shiftId" TEXT,
    "taskId" TEXT,
    "type" "CourierPayoutType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierPayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Courier_tenantId_status_idx" ON "Courier"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_tenantId_telegramUserId_key" ON "Courier"("tenantId", "telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_tenantId_phone_key" ON "Courier"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "CourierShift_venueId_endedAt_state_queuedAt_idx" ON "CourierShift"("venueId", "endedAt", "state", "queuedAt");

-- CreateIndex
CREATE INDEX "CourierShift_courierId_startedAt_idx" ON "CourierShift"("courierId", "startedAt");

-- CreateIndex
CREATE INDEX "DeliveryTask_venueId_status_createdAt_idx" ON "DeliveryTask"("venueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryTask_courierId_status_idx" ON "DeliveryTask"("courierId", "status");

-- CreateIndex
CREATE INDEX "DeliveryTask_orderId_idx" ON "DeliveryTask"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryTask_batchId_idx" ON "DeliveryTask"("batchId");

-- CreateIndex
CREATE INDEX "DeliveryTaskEvent_tenantId_at_idx" ON "DeliveryTaskEvent"("tenantId", "at");

-- CreateIndex
CREATE INDEX "DeliveryTaskEvent_taskId_at_idx" ON "DeliveryTaskEvent"("taskId", "at");

-- CreateIndex
CREATE INDEX "DeliveryTaskEvent_shiftId_at_idx" ON "DeliveryTaskEvent"("shiftId", "at");

-- CreateIndex
CREATE INDEX "CourierCashEntry_courierId_status_createdAt_idx" ON "CourierCashEntry"("courierId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CourierCashEntry_tenantId_createdAt_idx" ON "CourierCashEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlement_courierId_status_idx" ON "CourierSettlement"("courierId", "status");

-- CreateIndex
CREATE INDEX "CourierSettlement_tenantId_createdAt_idx" ON "CourierSettlement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierPayoutLine_courierId_createdAt_idx" ON "CourierPayoutLine"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierPayoutLine_shiftId_idx" ON "CourierPayoutLine"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchDevice_tokenHash_key" ON "DispatchDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "DispatchDevice_venueId_isActive_idx" ON "DispatchDevice"("venueId", "isActive");

-- AddForeignKey
ALTER TABLE "Courier" ADD CONSTRAINT "Courier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierShift" ADD CONSTRAINT "CourierShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierShift" ADD CONSTRAINT "CourierShift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierShift" ADD CONSTRAINT "CourierShift_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CourierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTaskEvent" ADD CONSTRAINT "DeliveryTaskEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTaskEvent" ADD CONSTRAINT "DeliveryTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DeliveryTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTaskEvent" ADD CONSTRAINT "DeliveryTaskEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CourierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierCashEntry" ADD CONSTRAINT "CourierCashEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierCashEntry" ADD CONSTRAINT "CourierCashEntry_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierCashEntry" ADD CONSTRAINT "CourierCashEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DeliveryTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlement" ADD CONSTRAINT "CourierSettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlement" ADD CONSTRAINT "CourierSettlement_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierPayoutLine" ADD CONSTRAINT "CourierPayoutLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierPayoutLine" ADD CONSTRAINT "CourierPayoutLine_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierPayoutLine" ADD CONSTRAINT "CourierPayoutLine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DeliveryTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchDevice" ADD CONSTRAINT "DispatchDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchDevice" ADD CONSTRAINT "DispatchDevice_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Правила, которые Prisma не описывает ─────────────────────────────

-- У курьера одна открытая смена: двойной скан QR не создаёт вторую.
CREATE UNIQUE INDEX "CourierShift_one_open_per_courier"
ON "CourierShift"("courierId") WHERE "endedAt" IS NULL;

-- У заказа одна основная плитка (доставка или самовывоз); довозов сколько угодно.
CREATE UNIQUE INDEX "DeliveryTask_one_main_per_order"
ON "DeliveryTask"("orderId") WHERE "kind" IN ('DELIVERY', 'PICKUP');

-- Наличные с клиента записываются в долг курьеру один раз на задачу,
-- даже если «Доставлен» пришёл дважды (повтор запроса, двойное нажатие).
CREATE UNIQUE INDEX "CourierCashEntry_one_collect_per_task"
ON "CourierCashEntry"("taskId") WHERE "type" = 'COLLECTED';

-- Оплата за поездку начисляется один раз на задачу.
CREATE UNIQUE INDEX "CourierPayoutLine_one_trip_pay_per_task"
ON "CourierPayoutLine"("taskId") WHERE "type" IN ('DELIVERY', 'EXTRA_TRIP', 'FAILED_TRIP');

-- Одна неподтверждённая сдача налички на курьера: двойное «Сдаю» не
-- создаёт двух карточек у кассы.
CREATE UNIQUE INDEX "CourierCashEntry_one_pending_handover"
ON "CourierCashEntry"("courierId") WHERE "type" = 'HANDED_IN' AND "status" = 'PENDING';

-- Один неоконченный расчёт на курьера.
CREATE UNIQUE INDEX "CourierSettlement_one_pending"
ON "CourierSettlement"("courierId") WHERE "status" = 'PENDING';
