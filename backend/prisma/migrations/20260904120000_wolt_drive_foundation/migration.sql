-- Wolt Drive configuration is tenant-scoped so another restaurant can use
-- its own merchant key and venue without sharing PizzBurg credentials.
CREATE TABLE "WoltDriveAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'disabled',
    "merchantKey" TEXT NOT NULL DEFAULT '',
    "merchantId" TEXT,
    "venueId" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "postCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WoltDriveAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WoltDriveDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUOTED',
    "shipmentPromiseId" TEXT NOT NULL,
    "promiseValidUntil" TIMESTAMP(3) NOT NULL,
    "promiseDropoff" JSONB NOT NULL,
    "quotePriceAmount" INTEGER NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "quoteIsBinding" BOOLEAN NOT NULL,
    "pickupEtaMinutes" INTEGER,
    "dropoffEtaMinutes" INTEGER,
    "preparationTimeMinutes" INTEGER NOT NULL,
    "bagCount" INTEGER NOT NULL DEFAULT 1,
    "woltOrderReferenceId" TEXT,
    "trackingUrl" TEXT,
    "requestedBy" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WoltDriveDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WoltDriveAccount_tenantId_key" ON "WoltDriveAccount"("tenantId");
CREATE UNIQUE INDEX "WoltDriveDelivery_orderId_key" ON "WoltDriveDelivery"("orderId");
CREATE UNIQUE INDEX "WoltDriveDelivery_woltOrderReferenceId_key" ON "WoltDriveDelivery"("woltOrderReferenceId");
CREATE INDEX "WoltDriveDelivery_tenantId_status_idx" ON "WoltDriveDelivery"("tenantId", "status");

ALTER TABLE "WoltDriveAccount"
ADD CONSTRAINT "WoltDriveAccount_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WoltDriveDelivery"
ADD CONSTRAINT "WoltDriveDelivery_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WoltDriveDelivery"
ADD CONSTRAINT "WoltDriveDelivery_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
