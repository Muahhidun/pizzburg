-- Удаление аккаунта клиентом: строка остаётся ради заказов, персональные
-- данные из неё вычищаются.
ALTER TABLE "Customer" ADD COLUMN "deletedAt" TIMESTAMP(3);
