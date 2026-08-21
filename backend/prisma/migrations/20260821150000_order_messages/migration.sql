-- Обращения клиента по живому заказу (DECISIONS §12.21).
--
-- Телефон кассы не публикуется: звонок сбивает смену, где одновременно
-- идут зал, агрегаторы и наши заказы. Обращение письменное, привязано к
-- заказу и размечено темой — кассир видит запрос, а не абзац.
CREATE TABLE "OrderMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- По заказу и времени: и лимит частоты считается этим же индексом
CREATE INDEX "OrderMessage_orderId_createdAt_idx"
    ON "OrderMessage"("orderId", "createdAt");

ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
