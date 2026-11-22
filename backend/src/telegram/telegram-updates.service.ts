import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramUpdateHandler, TgUpdate } from './telegram.types';

/**
 * Дополнительные получатели входящих апдейтов бота.
 *
 * Вебхук один (TelegramRepliesController, ответы кассира клиенту). Модули
 * вроде курьерского регистрируют здесь обработчик при старте, и вебхук
 * сперва предлагает апдейт им: кто взял — тот и обработал, остальное
 * идёт в ответы кассира как раньше. Так TelegramModule остаётся
 * глобальным и не зависит от предметных модулей.
 */
@Injectable()
export class TelegramUpdatesService {
  private readonly logger = new Logger(TelegramUpdatesService.name);
  private readonly handlers: TelegramUpdateHandler[] = [];

  constructor(private readonly telegram: TelegramService) {}

  register(handler: TelegramUpdateHandler) {
    this.handlers.push(handler);
  }

  /**
   * true — апдейт обработан здесь. Ошибку обработчика считаем «взял»:
   * отдавать недоделанный апдейт дальше было бы хуже, а Телеграму всё
   * равно отвечаем 200, иначе он будет слать его снова.
   */
  async dispatch(tenantId: string, update: TgUpdate): Promise<boolean> {
    for (const handler of this.handlers) {
      try {
        if (await handler(tenantId, update)) return true;
      } catch (e) {
        this.logger.error(
          `Апдейт ${update.update_id ?? '?'} не обработан: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (update.callback_query) {
          await this.telegram.call(tenantId, 'answerCallbackQuery', {
            callback_query_id: update.callback_query.id,
            text: 'Не получилось, попробуйте ещё раз',
          });
        }
        return true;
      }
    }
    return false;
  }
}
