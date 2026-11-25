-- Заказы старого приложения и сайта, пришедшие в Poster мимо нас:
-- плитка на планшете без нашего Order, со снимком данных из Poster.
ALTER TABLE "DeliveryTask" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "DeliveryTask" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'APP';
ALTER TABLE "DeliveryTask" ADD COLUMN "external" JSONB;
ALTER TABLE "DeliveryTask" ADD COLUMN "externalKey" TEXT;
CREATE UNIQUE INDEX "DeliveryTask_tenantId_externalKey_key" ON "DeliveryTask"("tenantId", "externalKey");
