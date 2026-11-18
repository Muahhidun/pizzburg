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

    // При подключённом вебхуке getUpdates Телеграм не отдаёт — тогда
    // берём чат, из которого боту писали последним (его запомнил вебхук).
    const seen = this.lastChats.get(tenantId);
    if (seen) return seen;

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

  private readonly lastChats = new Map<string, { chatId: string; title: string }>();

  /** Чат, из которого пришло последнее сообщение боту (для detectChat) */
  rememberChat(tenantId: string, chat: { id: number; title?: string; username?: string }) {
    this.lastChats.set(tenantId, {
      chatId: String(chat.id),
      title: chat.title ?? chat.username ?? '',
    });
  }

  /** Проверка связи из админки — здесь ошибку показываем, а не глотаем */
  async sendTest(tenantId: string, target: 'OWNER' | 'CASHIER' = 'OWNER') {
    const s = await this.settings(tenantId);
    if (!s.botToken) throw new BadRequestException('Не задан токен бота');
    const chatId = target === 'CASHIER' ? s.cashierChatId : s.chatId;
    if (!chatId) throw new BadRequestException('Не задан чат');
    const { error } = await this.deliver(
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
    const { error } = await this.deliver(s, text);
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
   *
   * `keyboard` — кнопки под сообщением (быстрые ответы клиенту).
   * Возвращаем id сообщения: по нему потом ловим нажатие и ответ.
   */
  async notifyCashier(
    tenantId: string,
    text: string,
    keyboard?: InlineButton[][],
  ): Promise<{ sent: boolean; chatId?: string; messageId?: number }> {
    const s = await this.settings(tenantId);
    if (!s.enabled || !s.botToken || !s.cashierChatId) return { sent: false };
    const { error, messageId } = await this.deliver(
      { ...s, chatId: s.cashierChatId },
      text,
      keyboard ? { reply_markup: { inline_keyboard: keyboard } } : undefined,
    );
    if (error) {
      this.logger.warn(`Телеграм кассы не принял сообщение: ${error}`);
      // Касса не узнала — пусть узнает руководство. №103 так и потерялся:
      // один сбой сети, и о заказе в группе кассиров не было ни слова.
      if (s.chatId && s.chatId !== s.cashierChatId) {
        await this.deliver(
          s,
          `⚠️ <b>Не дошло до группы кассиров</b> (${esc(error)}):\n\n${text}`,
        );
      }
      return { sent: false };
    }
    return { sent: true, chatId: s.cashierChatId, messageId };
  }

  /** Вызов Bot API от имени бота заведения; ошибку возвращаем строкой */
  async call(
    tenantId: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<{ error: string | null; result?: any }> {
    const s = await this.settings(tenantId);
    if (!s.botToken) return { error: 'Не задан токен бота' };
    return this.request(s.botToken, method, payload);
  }

  /**
   * Подключить приём нажатий кнопок и ответов кассира.
   *
   * Вебхук, а не опрос getUpdates: один бот у боевого сервера и у теста,
   * и опрос с двух мест крал бы нажатия друг у друга. Секрет в заголовке
   * отличает настоящий Телеграм от любого, кто узнал адрес.
   */
  async connectWebhook(tenantId: string, url: string, secret: string) {
    return this.call(tenantId, 'setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['callback_query', 'message'],
      drop_pending_updates: false,
    });
  }

  private async deliver(
    s: TelegramSettings,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<{ error: string | null; messageId?: number }> {
    const { error, result } = await this.request(s.botToken, 'sendMessage', {
      chat_id: s.chatId,
      text: linkOrderNumbers(text),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
    return { error, messageId: result?.message_id };
  }

  /**
   * Запрос к Bot API с повтором.
   *
   * Сеть между Railway и Телеграмом иногда рвётся на секунду («fetch
   * failed»), и без повтора сообщение просто терялось. Повторяем только
   * то, что могло пройти со второго раза: сбой сети, 429 и 5xx. Ошибку
   * в самом сообщении (неверный чат, разметка) повтор не исправит.
   */
  private async request(
    token: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<{ error: string | null; result?: any }> {
    let last = '';
    let retryAfterSec: number | undefined;
    for (let attempt = 0; attempt < this.retryDelaysMs.length + 1; attempt++) {
      if (attempt > 0) await sleep(this.retryDelay(attempt, retryAfterSec));
      try {
        const res = await this.fetchImpl(`${API}/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok: boolean;
          description?: string;
          result?: unknown;
          parameters?: { retry_after?: number };
        };
        if (json.ok) return { error: null, result: json.result };
        last = json.description ?? `HTTP ${res.status}`;
        retryAfterSec = json.parameters?.retry_after;
        if (res.status !== 429 && res.status < 500) return { error: last };
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        retryAfterSec = undefined;
      }
    }
    return { error: last };
  }

  private retryDelay(attempt: number, retryAfterSec?: number) {
    const fromTelegram = retryAfterSec ? retryAfterSec * 1000 : 0;
    return Math.min(Math.max(this.retryDelaysMs[attempt - 1], fromTelegram), 30_000);
  }

  /** Подменяются в тестах */
  retryDelaysMs = RETRY_DELAYS_MS;
  fetchImpl: typeof fetch = (...args) => fetch(...args);
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Паузы перед повторами: сбой сети обычно проходит за секунды */
export const RETRY_DELAYS_MS = [2_000, 5_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const esc = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Адрес админки для ссылок из Телеграма. Railway сам кладёт адрес
 * соседнего сервиса в RAILWAY_SERVICE_ADMIN_URL; ADMIN_PUBLIC_URL —
 * если админка переедет на свой домен.
 */
export function adminBaseUrl(): string {
  const explicit = process.env.ADMIN_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const railway = process.env.RAILWAY_SERVICE_ADMIN_URL?.trim();
  return railway ? `https://${railway.replace(/\/$/, '')}` : '';
}

/**
 * Номера заказов в сообщениях — ссылками на заказ в админке.
 *
 * Нажал на №114 в «похоже на перезаказ» — и видишь, что это за заказ.
 * Номер чека Poster («чек №105509») ссылкой не делаем: это другой
 * номер, и ссылка вела бы на чужой заказ. Уже оформленные ссылки не
 * трогаем.
 */
export function linkOrderNumbers(text: string, base = adminBaseUrl()): string {
  if (!base || !text.includes('№')) return text;
  return text
    .split(/(<a\b[^>]*>.*?<\/a>)/is)
    .map((chunk) =>
      chunk.startsWith('<a')
        ? chunk
        : chunk.replace(
            /(^|[^\p{L}])(?<!чек\s)(?<!ЧЕК\s)(?<!Чек\s)№(\d+)(?![\d\/-])/gu,
            (_m, pre: string, n: string) =>
              `${pre}<a href="${base}/orders?n=${n}">№${n}</a>`,
          ),
    )
    .join('');
}
