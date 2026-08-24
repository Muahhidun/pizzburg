-- Казахские тексты, которые видит клиент.
ALTER TABLE "CancelReason" ADD COLUMN "labelKk" TEXT;
-- Язык устройства: пуши отправляются на нём, а не на языке заведения.
ALTER TABLE "PushDevice" ADD COLUMN "lang" TEXT NOT NULL DEFAULT 'ru';
