-- Когда чек ушёл на планшет: от этого считаем «заказ долго не принимают»
ALTER TABLE "OrderDispatch" ADD COLUMN "sentAt" TIMESTAMP(3);

-- Сколько напоминаний о непринятом заказе уже отправлено (0, 1 — кассе, 2 — руководству)
ALTER TABLE "Order" ADD COLUMN "acceptReminders" INTEGER NOT NULL DEFAULT 0;
