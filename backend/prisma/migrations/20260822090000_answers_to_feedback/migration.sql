-- Место под ответ заведения на обращение и на отзыв.
--
-- Писать его пока некому — механизм ответа отдельной задачей, — но без
-- этих полей лента показывает только половину разговора, и понять,
-- разобрались ли с человеком, по ней нельзя.
ALTER TABLE "OrderMessage" ADD COLUMN "answeredAt" TIMESTAMP(3);
ALTER TABLE "OrderMessage" ADD COLUMN "answeredBy" TEXT;
ALTER TABLE "OrderMessage" ADD COLUMN "answerText" TEXT;

ALTER TABLE "OrderReview" ADD COLUMN "answeredAt" TIMESTAMP(3);
ALTER TABLE "OrderReview" ADD COLUMN "answeredBy" TEXT;
ALTER TABLE "OrderReview" ADD COLUMN "answerText" TEXT;
