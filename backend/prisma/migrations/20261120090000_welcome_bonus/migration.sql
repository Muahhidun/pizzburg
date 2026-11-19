-- Подарок за вход в приложение: отметка, что клиент его уже получил
ALTER TABLE "Customer" ADD COLUMN "welcomeBonusAt" TIMESTAMP(3);
