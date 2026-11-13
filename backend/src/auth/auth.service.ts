import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { TelegramGatewayService } from '../sms/telegram-gateway.service';
import { normalizeKzPhone } from '../common/phone';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * Потолок запросов кода на номер в сутки. Держит две угрозы сразу: счёт за
 * SMS-бомбинг и перебор кода. Без него минутный кулдаун даёт 1 440 кодов
 * в сутки по 5 попыток каждый — то есть 7 200 догадок, а этого хватает,
 * чтобы вскрыть шестизначный код за несколько дней.
 */
const MAX_PER_DAY = 10;
const CODE_DIGITS = 6;

/**
 * Telegram-код: сколько ждать подтверждения доставки, прежде чем молча
 * отправить тот же код SMS. Обычно Telegram доставляет за 1–2 секунды;
 * 15 — запас на слабую сеть, но не столько, чтобы человек заскучал.
 */
export const TELEGRAM_AUTO_FALLBACK_MS = 15_000;
/** Через сколько после Telegram-кода приложение даёт кнопку «по SMS». */
export const TELEGRAM_MANUAL_FALLBACK_MS = 25_000;
/** Срок Telegram-сообщения: не доставлено за это время — деньги вернут. */
const TELEGRAM_TTL_SECONDS = 60;

/** Канал, который понимает клиент. Старые сборки не шлют ничего — им SMS. */
export type OtpChannel = 'auto' | 'sms';

type TelegramPending = {
  code: string;
  requestId: string;
  sentAt: number;
  smsSent: boolean;
};

/**
 * Номера, которым dev-режим отдаёт код прямо в ответе. Список задаётся
 * `OTP_TEST_PHONES` (через запятую) и по умолчанию пуст.
 */
function testPhones(logger: Logger): Set<string> {
  const result = new Set<string>();
  for (const part of (process.env.OTP_TEST_PHONES ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      result.add(normalizeKzPhone(trimmed));
    } catch {
      logger.error(`OTP_TEST_PHONES: «${trimmed}» — не номер, запись пропущена`);
    }
  }
  return result;
}

/**
 * Постоянный код для тестовых номеров: `OTP_TEST_CODE`.
 *
 * Нужен ревью App Store и Google Play — проверяющий сидит не в
 * Казахстане и SMS не получит, поэтому ему отдают пару «номер + код».
 * Без заданного значения тестовые номера не работают вовсе: пустой
 * код молча пускал бы кого угодно.
 */
function testCode(): string {
  const raw = (process.env.OTP_TEST_CODE ?? '').trim();
  return raw.length >= 4 ? raw : randomInt(0, 10 ** CODE_DIGITS).toString();
}

/**
 * Вход по телефону + SMS-код. Телефон — идентификатор клиента (профили
 * переживут миграцию с FoodPicasso).
 *
 * Код уходит настоящей SMS через Mobizon. Dev-режим остаётся запасным
 * путём: он включается, только если провайдер не настроен, — чтобы
 * локальная разработка не требовала оплаченного баланса.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Коды, ушедшие в Telegram, по номеру. В памяти, а не в базе: живут
   * минуту, и после перезапуска сервера худшее, что случится, — человек
   * подождёт обычную минуту до повторного кода.
   */
  private readonly telegramPending = new Map<string, TelegramPending>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly telegram: TelegramGatewayService,
  ) {}

  /**
   * Запросить код входа.
   *
   * `auto` — новые сборки приложения: сначала Telegram, при неудаче SMS.
   * `sms` — старые сборки и сайт, а также кнопка «Отправить по SMS»: если
   * минуту назад код ушёл в Telegram, тот же код уходит SMS без новой
   * минуты ожидания (DECISIONS §12.40).
   */
  async requestOtp(phone: string, channel: OtpChannel = 'sms') {
    const normalized = normalizeKzPhone(phone);

    if (channel === 'sms') {
      const fallback = await this.smsAfterTelegram(normalized);
      if (fallback) return fallback;
    }

    const recent = await this.prisma.otpCode.findFirst({
      where: {
        phone: normalized,
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
      },
    });
    if (recent) {
      throw new BadRequestException('Код уже отправлен, подождите минуту');
    }

    const perDay = await this.prisma.otpCode.count({
      where: {
        phone: normalized,
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (perDay >= MAX_PER_DAY) {
      this.logger.warn(`Превышен суточный лимит запросов кода для ${normalized}`);
      throw new BadRequestException(
        'Слишком много запросов кода. Попробуйте позже',
      );
    }

    const isTestPhone = testPhones(this.logger).has(normalized);

    // Тестовым номерам — постоянный код из настроек, остальным случайный.
    //
    // Раньше код тестового номера возвращался прямо в ответе, и защитой
    // служил сам номер: кто его знает, тот и войдёт. Это плохая защита —
    // номер короткий и его подбирают. Теперь для входа нужно знать и
    // номер, и код, а код в ответ не уходит (DECISIONS §12.34).
    //
    // randomInt, а не Math.random: код — это одноразовый пароль, и
    // предсказуемый генератор здесь равносилен отсутствию кода.
    const code = isTestPhone
      ? testCode()
      : String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');

    await this.prisma.otpCode.create({
      data: {
        phone: normalized,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // Тестовые номера обслуживаем без SMS даже при живом провайдере:
    // проверять вход десять раз подряд за деньги незачем.
    if (isTestPhone) {
      this.logger.warn(`Вход по тестовому номеру ${normalized}`);
      return { sent: true, channel: 'sms' as const };
    }

    if (channel === 'auto' && this.telegram.configured) {
      const requestId = await this.telegram.sendCode(
        normalized,
        code,
        TELEGRAM_TTL_SECONDS,
      );
      if (requestId) {
        this.rememberTelegram(normalized, { code, requestId });
        return {
          sent: true,
          channel: 'telegram' as const,
          smsFallbackAfterMs: TELEGRAM_MANUAL_FALLBACK_MS,
        };
      }
    }

    if (this.sms.configured) {
      await this.sendSms(normalized, code);
      return { sent: true, channel: 'sms' as const };
    }

    // Провайдер не настроен — только для локальной разработки
    if (process.env.OTP_DEV_MODE === '1') {
      this.logger.warn(`OTP для ${normalized}: ${code}`);
      return { sent: true, channel: 'sms' as const };
    }
    this.logger.error('SMS-провайдер не настроен, а OTP_DEV_MODE выключен');
    throw new BadRequestException('Отправка SMS временно недоступна');
  }

  private async sendSms(phone: string, code: string) {
    try {
      await this.sms.sendOtp(phone, code);
    } catch (error) {
      // Причину пишем в лог, клиенту не показываем: в тексте ошибки
      // провайдера бывает и остаток баланса, и номер счёта.
      this.logger.error(
        `SMS с кодом не отправлена на ${phone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'Не удалось отправить SMS. Попробуйте ещё раз через минуту',
      );
    }
  }

  /**
   * Запомнить Telegram-код и через 15 секунд проверить доставку: не дошёл —
   * тот же код уходит SMS сам, человек ничего не нажимает.
   */
  private rememberTelegram(
    phone: string,
    sent: { code: string; requestId: string },
  ) {
    const now = Date.now();
    for (const [key, value] of this.telegramPending) {
      if (now - value.sentAt > OTP_TTL_MS) this.telegramPending.delete(key);
    }
    const entry: TelegramPending = { ...sent, sentAt: now, smsSent: false };
    this.telegramPending.set(phone, entry);

    const timer = setTimeout(async () => {
      // Код уже введён, или поверх ушёл новый — проверять нечего
      if (this.telegramPending.get(phone) !== entry || entry.smsSent) return;
      if (await this.telegram.delivered(entry.requestId)) return;
      if (this.telegramPending.get(phone) !== entry || entry.smsSent) return;
      entry.smsSent = true;
      this.logger.warn(`Telegram не доставил код на ${phone} — отправляем SMS`);
      if (!this.sms.configured) return;
      await this.sendSms(phone, entry.code).catch(() => undefined);
    }, TELEGRAM_AUTO_FALLBACK_MS);
    timer.unref?.();
  }

  /**
   * Кнопка «Отправить по SMS» после Telegram-кода. Тот же код, а не новый:
   * иначе в Telegram и в SMS лежали бы два разных кода, и верный был бы
   * только один из них.
   *
   * @returns ответ, если кнопка относилась к Telegram-коду; null — обычный
   * запрос SMS, пусть идёт общей дорогой с минутным кулдауном
   */
  private async smsAfterTelegram(phone: string) {
    const entry = this.telegramPending.get(phone);
    if (!entry) return null;
    const age = Date.now() - entry.sentAt;
    if (age > OTP_TTL_MS) return null;
    if (entry.smsSent) return { sent: true, channel: 'sms' as const };
    if (age < TELEGRAM_MANUAL_FALLBACK_MS) {
      const seconds = Math.ceil((TELEGRAM_MANUAL_FALLBACK_MS - age) / 1000);
      throw new BadRequestException(
        `Код уже в Telegram. SMS можно запросить через ${seconds} с`,
      );
    }
    if (this.sms.configured) await this.sendSms(phone, entry.code);
    entry.smsSent = true;
    return { sent: true, channel: 'sms' as const };
  }

  async verifyOtp(tenantSlug: string, phone: string, code: string) {
    const normalized = normalizeKzPhone(phone);
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: normalized, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Код истёк, запросите новый');
    }
    if (otp.code !== code) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Неверный код');
    }
    await this.prisma.otpCode.deleteMany({ where: { phone: normalized } });

    // Код введён — запасная SMS больше не нужна, а Telegram узнаёт о
    // входе для своей статистики конверсии
    const pending = this.telegramPending.get(normalized);
    if (pending) {
      this.telegramPending.delete(normalized);
      if (pending.code === code) this.telegram.reportValid(pending.requestId, code);
    }

    const customer = await this.prisma.customer.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: normalized } },
      create: { tenantId: tenant.id, phone: normalized },
      update: {},
    });

    const token = await this.jwt.signAsync({
      sub: customer.id,
      tenantId: tenant.id,
      phone: normalized,
    });
    return {
      token,
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        pointsBalance: customer.pointsBalance,
      },
    };
  }

  /**
   * Удаление аккаунта по требованию клиента (DECISIONS §12.33).
   *
   * Строку клиента не удаляем, а обезличиваем: на неё ссылаются заказы,
   * а они нужны кассе, отчётности и налоговой. Удалить их значило бы
   * стереть выручку заведения вместе с профилем человека.
   *
   * Из заказов вычищаем то, что относится к человеку, — адрес и
   * комментарий курьеру. Суммы, состав и время остаются: это операции
   * заведения, а не персональные данные.
   */
  async deleteAccount(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, phone: true, tenantId: true, deletedAt: true },
    });
    if (!customer) throw new NotFoundException('Клиент не найден');
    if (customer.deletedAt) return { deleted: true };

    // Пока заказ в работе, удалять нельзя: курьер везёт по адресу,
    // который мы собираемся стереть, а кассир не сможет позвонить.
    const active = await this.prisma.order.count({
      where: {
        customerId,
        status: { in: ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
      },
    });
    if (active > 0) {
      throw new BadRequestException(
        'Сначала дождитесь доставки текущего заказа или отмените его',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pushDevice.deleteMany({ where: { customerId } });
      await tx.favorite.deleteMany({ where: { customerId } });
      await tx.customerAddress.deleteMany({ where: { customerId } });
      await tx.addressRequest.deleteMany({ where: { customerId } });
      await tx.appEvent.deleteMany({ where: { customerId } });
      await tx.otpCode.deleteMany({ where: { phone: customer.phone } });

      await tx.order.updateMany({
        where: { customerId },
        data: { address: Prisma.DbNull, comment: '' },
      });

      // Телефон входит в уникальный ключ, поэтому не обнуляем, а заменяем
      // на метку: иначе второй удалённый аккаунт не сохранится, а сам
      // номер должен освободиться для новой регистрации.
      await tx.customer.update({
        where: { id: customerId },
        data: {
          phone: `deleted:${customerId}`,
          name: null,
          birthday: null,
          pointsBalance: 0,
          lifetimeSpent: 0,
          loyaltyLevel: 1,
          pushToken: null,
          legalVersions: {},
          legalAcceptedAt: null,
          deletedAt: new Date(),
        },
      });
    });

    this.logger.warn(`Клиент ${customerId} удалил аккаунт`);
    return { deleted: true };
  }
}
