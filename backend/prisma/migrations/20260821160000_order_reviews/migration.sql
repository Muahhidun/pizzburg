-- Впечатление о заказе (DECISIONS §12.23).
--
-- Не звёзды: прямая оценка даёт либо пять, либо один — среднего люди не
-- ставят. Спрашиваем факты по сторонам заказа, оценку выводим сами.
ALTER TABLE "Order" ADD COLUMN "reviewAskedAt" TIMESTAMP(3);

CREATE TABLE "OrderReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReview_pkey" PRIMARY KEY ("id")
);

-- Один отзыв на заказ: анкета не опрос, второй раз не спрашиваем
CREATE UNIQUE INDEX "OrderReview_orderId_key" ON "OrderReview"("orderId");
CREATE INDEX "OrderReview_tenantId_createdAt_idx"
    ON "OrderReview"("tenantId", "createdAt");

ALTER TABLE "OrderReview" ADD CONSTRAINT "OrderReview_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderReview" ADD CONSTRAINT "OrderReview_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
