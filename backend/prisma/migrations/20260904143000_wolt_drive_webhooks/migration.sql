ALTER TABLE "WoltDriveAccount"
ADD COLUMN "webhookId" TEXT,
ADD COLUMN "webhookSecret" TEXT,
ADD COLUMN "webhookCallbackUrl" TEXT;

ALTER TABLE "WoltDriveDelivery"
ADD COLUMN "pickupEta" TIMESTAMP(3),
ADD COLUMN "dropoffEtaMin" TIMESTAMP(3),
ADD COLUMN "dropoffEtaMax" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "courierVehicleType" TEXT,
ADD COLUMN "handshakePin" TEXT;

CREATE TABLE "WoltDriveWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL,
    "woltOrderReferenceId" TEXT,
    "merchantOrderReferenceId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WoltDriveWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WoltDriveWebhookEvent_eventId_key"
ON "WoltDriveWebhookEvent"("eventId");

CREATE INDEX "WoltDriveWebhookEvent_tenantId_dispatchedAt_idx"
ON "WoltDriveWebhookEvent"("tenantId", "dispatchedAt");

CREATE INDEX "WoltDriveWebhookEvent_deliveryId_dispatchedAt_idx"
ON "WoltDriveWebhookEvent"("deliveryId", "dispatchedAt");

ALTER TABLE "WoltDriveWebhookEvent"
ADD CONSTRAINT "WoltDriveWebhookEvent_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WoltDriveWebhookEvent"
ADD CONSTRAINT "WoltDriveWebhookEvent_deliveryId_fkey"
FOREIGN KEY ("deliveryId") REFERENCES "WoltDriveDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
