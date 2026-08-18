import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';

/**
 * Глобальный: сообщать руководству может любой модуль, а плодить
 * импорты ради одного побочного канала незачем.
 */
@Global()
@Module({
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
