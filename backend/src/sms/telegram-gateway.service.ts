import { Injectable, Logger } from '@nestjs/common';

/** Статусы доставки из Telegram Gateway, которые значат «код у человека». */
const DELIVERED = new Set(['delivered', 'read']);

/**
 * Коды входа через Telegram Gateway (DECISIONS §12.40).
 *
 * Код приходит в Telegram от официального чата «Verification Codes» —
 * человеку не нужно ничего нажимать в нашем боте. Стоит $0,01 против
 * 17–20 ₸ за SMS, а недоставленный за `ttl` код Telegram возвращает сам.
 *
 * Сервис ничего не решает про SMS: он только пробует Telegram и говорит,
 * получилось ли. Запасной путь — забота AuthService.
 */
@Injectable()
export class TelegramGatewayService {
  private readonly logger = new Logger(TelegramGatewayService.name);
  private readonly baseUrl = 'https://gatewayapi.telegram.org';

  private get token() {
    return process.env.TELEGRAM_GATEWAY_TOKEN?.trim();
  }

  get configured() {
    return Boolean(this.token);
  }

  private async call<T>(method: string, params: Record<string, unknown>) {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      // Человек ждёт код на экране: дольше пяти секунд ждать Telegram
      // незачем, проще сразу отправить SMS
      signal: AbortSignal.timeout(5_000),
    });
    const json = (await res.json()) as { ok?: boolean; result?: T; error?: string };
    if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.result as T;
  }

  /**
   * Отправить наш код в Telegram.
   *
   * Сначала `checkSendAbility`: если у номера нет Telegram, проверка
   * бесплатна, и мы сразу уходим в SMS, не теряя секунд. Если есть —
   * отправка по полученному `request_id` уже не тарифицируется второй раз.
   *
   * @returns request_id или null, если Telegram недоступен для номера
   */
  async sendCode(phone: string, code: string, ttlSeconds: number) {
    if (!this.configured) return null;
    try {
      const check = await this.call<{ request_id: string }>('checkSendAbility', {
        phone_number: phone,
      });
      const sent = await this.call<{ request_id: string }>('sendVerificationMessage', {
        phone_number: phone,
        request_id: check.request_id,
        code,
        ttl: ttlSeconds,
      });
      return sent.request_id;
    } catch (error) {
      // Нет Telegram, кончился бюджет, сеть — для клиента это одно и то
      // же: код уйдёт SMS. Причину оставляем в логе.
      this.logger.warn(
        `Telegram-код не отправлен на ${phone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Дошёл ли код до устройства. Ошибку проверки считаем «не дошёл». */
  async delivered(requestId: string) {
    try {
      const status = await this.call<{ delivery_status?: { status?: string } }>(
        'checkVerificationStatus',
        { request_id: requestId },
      );
      return DELIVERED.has(status.delivery_status?.status ?? '');
    } catch {
      return false;
    }
  }

  /**
   * Сообщить Telegram, что код введён верно. Нужно только для статистики
   * конверсии в кабинете Gateway, поэтому без ожидания и без ошибок.
   */
  reportValid(requestId: string, code: string) {
    void this.call('checkVerificationStatus', { request_id: requestId, code }).catch(
      () => undefined,
    );
  }
}
