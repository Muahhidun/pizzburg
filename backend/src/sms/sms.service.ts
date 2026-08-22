import { Injectable, Logger } from '@nestjs/common';

/**
 * Отправка SMS через Mobizon (DECISIONS §12.25).
 *
 * Ключ живёт только в переменных окружения: в коде его быть не может —
 * репозиторий переживёт и смену подрядчика, и утечку, а ключ оплачивает
 * реальные деньги за каждое сообщение.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private get apiKey() {
    return process.env.MOBIZON_API_KEY?.trim();
  }

  private get baseUrl() {
    return (process.env.MOBIZON_API_URL ?? 'https://api.mobizon.kz').replace(
      /\/+$/,
      '',
    );
  }

  /**
   * Имя отправителя.
   *
   * Пусто — общее имя провайдера, и это осознанный старт: своё имя стоит
   * абонплаты за каждого оператора и окупается тысячами сообщений в
   * месяц, а не сотнями.
   */
  private get from() {
    return process.env.MOBIZON_FROM?.trim() || undefined;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  /**
   * Отправить сообщение. Номер — в международном формате, плюс уберём
   * сами: Mobizon его не принимает.
   */
  async send(phone: string, text: string): Promise<void> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('MOBIZON_API_KEY не задан');

    const body = new URLSearchParams({
      apiKey,
      recipient: phone.replace(/\D/g, ''),
      text,
    });
    if (this.from) body.set('from', this.from);

    const res = await fetch(`${this.baseUrl}/service/message/sendsmsmessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // Клиент ждёт код на экране входа: висеть минуту молча нельзя
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Mobizon ответил ${res.status}`);
    }

    const json = (await res.json()) as {
      code?: number;
      message?: string;
      data?: unknown;
    };

    // 0 — принято, 100 — принято в фоне. Остальное ошибка, и её текст
    // нужен в логе: «не отправилось» без причины чинить нечем.
    if (json.code !== 0 && json.code !== 100) {
      throw new Error(
        `Mobizon отказал: code=${json.code} ${json.message ?? ''}`.trim(),
      );
    }
  }

  /** Код для входа. Коротко: кириллица — 70 символов на одну SMS */
  async sendOtp(phone: string, code: string): Promise<void> {
    await this.send(phone, `PizzBurg: код ${code}. Никому не сообщайте`);
  }
}
