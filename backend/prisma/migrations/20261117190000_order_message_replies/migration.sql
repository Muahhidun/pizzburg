-- Ответы кассира на обращения клиента из группы Телеграма
ALTER TABLE "OrderMessage" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "OrderMessage" ADD COLUMN "telegramMessageId" INTEGER;
ALTER TABLE "OrderMessage" ADD COLUMN "replyPromptMessageId" INTEGER;

CREATE INDEX "OrderMessage_telegramChatId_telegramMessageId_idx" ON "OrderMessage"("telegramChatId", "telegramMessageId");
CREATE INDEX "OrderMessage_telegramChatId_replyPromptMessageId_idx" ON "OrderMessage"("telegramChatId", "replyPromptMessageId");
