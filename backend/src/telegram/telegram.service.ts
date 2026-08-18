import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Телеграм как канал руководства (DECISIONS §12.7).
 *
 * Бот меняет роль, а не исчезает: из рабочего инструмента кассира — она
 * заходила туда на каждый заказ — он становится каналом владельца.
 * Стоп-листы, отключение доставки, нехватка позиций: то, о чём иначе
 * узнаёшь, только если сам откроешь админку.
 *
 * Настройки лежат в `Tenant.settings.telegram`, а не в переменных
 * окружения: владелец меняет их из админки без деплоя. Тем же способом
 * в базе уже живут токены Poster, так что это не новая практика.
 *
 * Отправка — побочный канал: ошибка телеграма логируется, но никогда не
 * ломает то действие, о котором сообщала.
 */

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  /// Чат руководства: стоп-листы, нехватка, перезаказы
  chatId: string;
  /**
   * Чат кассы — отдельный, и это не удобство, а необходимость.
   *
   * Аудитории разные: в чат руководства идут сигналы наблюдения за
   * кассиром, и класть их перед тем, за кем наблюдают, бессмысленно. А
   * кассира нельзя заваливать тем, что не требует её действия, иначе
   * канал станет фоном и важное в нём потеряется.
   */
  cashierChatId: string;
}

const API = 'https://api.telegram.org';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async settings(tenantId: string): Promise<TelegramSettings> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const raw = ((tenant?.settings as Record<string, any>) ?? {}).telegram ?? {};
    return {
      enabled: raw.enabled === true,
      botToken: String(raw.botToken ?? ''),
      chatId: String(raw.chatId ?? ''),
      cashierChatId: String(raw.cashierChatId ?? ''),
    };
  }

  /** Настройки для админки — токен наружу не отдаём */
  async publicSettings(tenantId: string) {
    const s = await this.settings(tenantId);
    return {
      enabled: s.enabled,
      chatId: s.chatId,
      cashierChatId: s.cashierChatId,
      // Показываем только факт наличия и хвост: сверить, что вставлен
      // нужный токен, можно и так, а светить его в браузере незачем.
      botTokenSet: s.botToken.length > 0,
      botTokenHint: s.botToken ? `…${s.botToken.slice(-6)}` : '',
    };
  }

  async saveSettings(
    tenantId: string,
    patch: Partial<TelegramSettings>,
  ): Promise<void> {
    const current = await this.settings(tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings as Record<string, unknown>) ?? {};
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...settings,
          telegram: {
            enabled: patch.enabled ?? current.enabled,
            // Пустая строка означает «не меняли»: форма не присылает токен
            // обратно, потому что мы его ей и не показывали.
            botToken: patch.botToken?.trim() || current.botToken,
            chatId: patch.chatId?.trim() ?? current.chatId,
            cashierChatId: patch.cashierChatId?.trim() ?? current.cashierChatId,
          },
        } as object,
      },
    });
  }

  /**
   * Кому писать, если id чата ещё не задан.
   *
   * Владельцу не нужно искать свой chat id по инструкциям из интернета:
   * он пишет боту любое сообщение, жмёт кнопку в админке — и мы читаем
   * последние апдейты сами.
   */
  async detectChat(tenantId: string) {
    const { botToken } = await this.settings(tenantId);
    if (!botToken) throw new BadRequestException('Сначала сохраните токен бота');

    const res = await fetch(`${API}/bot${botToken}/getUpdates?limit=10`);
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { message?: { chat?: { id: number; title?: string; username?: string } } }[];
    };
    if (!json.ok) {
      throw new BadRequestException(
        `Телеграм отказал: ${json.description ?? 'неизвестная ошибка'}`,
      );
    }
    const chats = (json.result ?? [])
      .map((u) => u.message?.chat)
      .filter((c): c is { id: number; title?: string; username?: string } => !!c);
    if (chats.length === 0) {
      throw new BadRequestException(
        'Напишите боту любое сообщение и нажмите ещё раз',
      );
    }
    const chat = chats[chats.length - 1];
    return { chatId: String(chat.id), title: chat.title ?? chat.username ?? '' };
  }

  /** Проверка связи из админки — здесь ошибку показываем, а не глотаем */
  async sendTest(tenantId: string, target: 'OWNER' | 'CASHIER' = 'OWNER') {
    const s = await this.settings(tenantId);
    if (!s.botToken) throw new BadRequestException('Не задан токен бота');
    const chatId = target === 'CASHIER' ? s.cashierChatId : s.chatId;
    if (!chatId) throw new BadRequestException('Не задан чат');
    const error = await this.deliver(
      { ...s, chatId },
      target === 'CASHIER'
        ? 'Проверка связи: сюда будут приходить сообщения для кассы.'
        : 'Проверка связи: бот подключён.',
    );
    if (error) throw new BadRequestException(error);
    return { sent: true };
  }

  /**
   * Сообщение руководству. Ошибку не поднимаем: стоп-лист должен
   * поставиться, даже если телеграм лежит.
   */
  async notify(tenantId: string, text: string) {
    const s = await this.settings(tenantId);
    if (!s.enabled || !s.botToken || !s.chatId) return { sent: false };
    const error = await this.deliver(s, text);
    if (error) {
      this.logger.warn(`Телеграм не принял сообщение: ${error}`);
      return { sent: false };
    }
    return { sent: true };
  }

  /**
   * Сообщение кассиру. Отправляем только то, что требует действия **на
   * планшете** и о чём принтер сказать не может: о новом заказе и об
   * исправленном составе он печатает сам, а вот о смерти заказа у Poster
   * механизма нет. Всё остальное сюда не идёт — иначе вернём привычку
   * жить в телеграме, от которой ушли (DECISIONS §12.1).
   */
  async notifyCashier(tenantId: string, text: string) {
    const s = await this.settings(tenantId);
    if (!s.enabled || !s.botToken || !s.cashierChatId) return { sent: false };
    const error = await this.deliver({ ...s, chatId: s.cashierChatId }, text);
    if (error) {
      this.logger.warn(`Телеграм кассы не принял сообщение: ${error}`);
      return { sent: false };
    }
    return { sent: true };
  }

  private async deliver(s: TelegramSettings, text: string): Promise<string | null> {
    try {
      const res = await fetch(`${API}/bot${s.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: s.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const json = (await res.json()) as { ok: boolean; description?: string };
      return json.ok ? null : (json.description ?? `HTTP ${res.status}`);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
}
