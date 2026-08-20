-- Причины отмены, которые видит клиент.
--
-- Клиент отменяет заказ только внутри окна бесплатной отмены — в первую
-- минуту, пока заведение о заказе не знает. «Долгое ожидание» там
-- невозможно, а «Клиент передумал» он читает про себя в третьем лице.
-- Оставляем эти причины кассиру и убираем из приложения.
UPDATE "CancelReason"
   SET "availableToCustomer" = false
 WHERE "label" IN (
   'Клиент передумал',
   'Клиент ошибся в заказе',
   'Долгое ожидание'
 );

-- Не причина, а повтор кнопки, стоящей под списком.
UPDATE "CancelReason"
   SET "isActive" = false, "availableToCustomer" = false
 WHERE "label" = 'Я хочу отменить заказ';

-- Что на самом деле случается в первую минуту. Разнесено по пунктам не
-- ради отчёта как такового: пять из шести причин — это наш экран, на
-- котором человек ошибся, и по каждой видно, что чинить.
INSERT INTO "CancelReason" ("id", "tenantId", "label", "sortOrder", "isActive", "availableToCustomer")
SELECT gen_random_uuid()::text, t."id", v.label, v.ord, true, true
  FROM "Tenant" t
 CROSS JOIN (VALUES
   ('Не тот адрес', 101),
   ('Перепутал доставку и самовывоз', 102),
   ('Не тот способ оплаты', 103),
   ('Не то время', 104),
   ('Забыл добавить блюдо', 105),
   ('Просто передумал', 106)
 ) AS v(label, ord)
    ON CONFLICT ("tenantId", "label")
    DO UPDATE SET "availableToCustomer" = true, "isActive" = true;
