-- Допродажи: что предложить добавить к заказу (DECISIONS §12.20).
--
-- Привязка к витринной категории, а не общий список на всё меню: соус к
-- пицце уместен, соус к десерту — нет, и одно неуместное предложение
-- обесценивает все остальные. NULL в appCategoryId — «к любому заказу».
CREATE TABLE "UpsellItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "appCategoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UpsellItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UpsellItem_tenantId_appCategoryId_idx"
    ON "UpsellItem"("tenantId", "appCategoryId");

-- Один и тот же товар можно предлагать и к пицце, и к бургерам, но не
-- дважды к одному и тому же.
CREATE UNIQUE INDEX "UpsellItem_tenantId_productId_appCategoryId_key"
    ON "UpsellItem"("tenantId", "productId", "appCategoryId");

ALTER TABLE "UpsellItem" ADD CONSTRAINT "UpsellItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UpsellItem" ADD CONSTRAINT "UpsellItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UpsellItem" ADD CONSTRAINT "UpsellItem_appCategoryId_fkey"
    FOREIGN KEY ("appCategoryId") REFERENCES "AppCategory"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
