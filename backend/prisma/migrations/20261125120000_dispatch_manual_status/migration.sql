-- Раздача отметила «Забрал» / «Доставлен» на планшете вместо курьера
-- (пропадал интернет у планшета, 25.11.2026)
ALTER TYPE "PickupMethod" ADD VALUE IF NOT EXISTS 'DISPATCH';
ALTER TYPE "HandoffMethod" ADD VALUE IF NOT EXISTS 'DISPATCH';

-- «Клиент оплатил иначе»: курьер отметил, кассир подтверждает (CARD | KASPI)
ALTER TABLE "CourierCashEntry" ADD COLUMN "paidBy" TEXT;
