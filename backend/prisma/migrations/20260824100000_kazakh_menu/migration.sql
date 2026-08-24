-- Казахская витрина: пустое поле означает «показываем русское».
ALTER TABLE "AppCategory" ADD COLUMN "nameKk" TEXT;
ALTER TABLE "Product" ADD COLUMN "displayNameKk" TEXT;
ALTER TABLE "Product" ADD COLUMN "displayDescriptionKk" TEXT;
ALTER TABLE "Product" ADD COLUMN "weightLabelKk" TEXT;
