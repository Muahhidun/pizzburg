-- AlterTable
ALTER TABLE "AppCategory" ADD COLUMN     "stoppedReason" TEXT,
ADD COLUMN     "stoppedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stoppedReason" TEXT,
ADD COLUMN     "stoppedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StopEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "appCategoryId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "StopEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StopEvent_tenantId_startedAt_idx" ON "StopEvent"("tenantId", "startedAt");

-- AddForeignKey
ALTER TABLE "StopEvent" ADD CONSTRAINT "StopEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopEvent" ADD CONSTRAINT "StopEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopEvent" ADD CONSTRAINT "StopEvent_appCategoryId_fkey" FOREIGN KEY ("appCategoryId") REFERENCES "AppCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
