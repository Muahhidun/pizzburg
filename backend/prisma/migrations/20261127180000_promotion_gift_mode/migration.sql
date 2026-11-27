-- Акции 4+1: подарок «самый дешёвый из корзины» / «такой же» и условие по одной позиции
ALTER TABLE "Promotion" ADD COLUMN "conditionProductId" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "giftMode" TEXT NOT NULL DEFAULT 'FIXED';
