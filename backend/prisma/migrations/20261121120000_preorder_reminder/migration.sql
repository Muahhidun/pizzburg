-- Напоминание кассе за 30 минут до предзаказа: отметка, что оно отправлено
ALTER TABLE "Order" ADD COLUMN "preorderRemindedAt" TIMESTAMP(3);
