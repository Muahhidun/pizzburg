-- Separate staff accounts and an immutable operational audit trail.
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'CASHIER');

CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" "StaffRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffUser_tenantId_username_key" ON "StaffUser"("tenantId", "username");
CREATE INDEX "StaffUser_tenantId_isActive_idx" ON "StaffUser"("tenantId", "isActive");
CREATE INDEX "AdminAuditLog_tenantId_createdAt_idx" ON "AdminAuditLog"("tenantId", "createdAt");
CREATE INDEX "AdminAuditLog_staffUserId_createdAt_idx" ON "AdminAuditLog"("staffUserId", "createdAt");

ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_staffUserId_fkey"
  FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
