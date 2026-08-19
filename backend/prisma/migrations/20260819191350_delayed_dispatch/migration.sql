-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "dispatchAfter" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_dispatchAfter_idx" ON "Order"("dispatchAfter");
