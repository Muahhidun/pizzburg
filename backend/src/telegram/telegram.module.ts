import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramUpdatesService } from './telegram-updates.service';

/**
 * Глобальный: сообщать руководству может любой модуль, а плодить
 * импорты ради одного побочного канала незачем. Входящие апдейты
 * модули получают, регистрируя обработчик в TelegramUpdatesService.
 */
@Global()
@Module({
  providers: [TelegramService, TelegramUpdatesService],
  exports: [TelegramService, TelegramUpdatesService],
})
export class TelegramModule {}
