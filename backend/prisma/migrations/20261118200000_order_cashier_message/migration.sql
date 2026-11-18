-- Где в группе кассиров лежит сообщение о заказе: номер заказа в других
-- сообщениях бота ведёт прямо на него
ALTER TABLE "Order" ADD COLUMN "cashierChatId" TEXT;
ALTER TABLE "Order" ADD COLUMN "cashierMessageId" INTEGER;
