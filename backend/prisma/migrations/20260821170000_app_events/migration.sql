-- Поведенческие события (DECISIONS §12.24).
--
-- Заказы отвечают, что купили. Эти события — что смотрели и не купили,
-- а это разные вопросы. Задним числом такие данные не восстановить.
CREATE TABLE "AppEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customerId" TEXT,
    "deviceId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppEvent_pkey" PRIMARY KEY ("id")
);

-- Отчёты ходят по типу и времени; воронка одного человека — по клиенту
CREATE INDEX "AppEvent_tenantId_type_at_idx" ON "AppEvent"("tenantId", "type", "at");
CREATE INDEX "AppEvent_tenantId_at_idx" ON "AppEvent"("tenantId", "at");
CREATE INDEX "AppEvent_customerId_at_idx" ON "AppEvent"("customerId", "at");

ALTER TABLE "AppEvent" ADD CONSTRAINT "AppEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Клиента можно удалить по требованию об удалении данных, а событие
-- останется обезличенным: отчёты не должны рассыпаться от одного ухода
ALTER TABLE "AppEvent" ADD CONSTRAINT "AppEvent_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
