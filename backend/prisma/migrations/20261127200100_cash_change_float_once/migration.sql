-- Сдача записывается один раз на задачу, даже при двойном «Доставлен».
-- Отдельной миграцией: новое значение enum нельзя использовать в той же транзакции, где его добавили.
CREATE UNIQUE INDEX "CourierCashEntry_one_change_float_per_task"
ON "CourierCashEntry"("taskId") WHERE "type" = 'CHANGE_FLOAT';
