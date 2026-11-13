-- Kaspi PaymentLink/QrToken: клиент может вернуться к неоплаченной попытке.
ALTER TABLE "PaymentAttempt" ADD COLUMN "paymentLink" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "qrToken" TEXT;
