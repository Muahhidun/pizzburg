-- Касса WDrink как отдел (DECISIONS §15). Только новые колонки с умолчаниями:
-- существующие отделы Poster работают как раньше.
ALTER TABLE "PosterAccount" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'POSTER';
ALTER TABLE "PosterAccount" ADD COLUMN "apiUrl" TEXT;
ALTER TABLE "PosterAccount" ADD COLUMN "preorderLeadMin" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "OrderDispatch" ADD COLUMN "showAt" TIMESTAMP(3);
ALTER TABLE "OrderDispatch" ADD COLUMN "acceptReminders" INTEGER NOT NULL DEFAULT 0;
