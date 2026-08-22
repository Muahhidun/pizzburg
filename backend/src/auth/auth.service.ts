import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
  ) {}

  async requestOtp(phone: string) {
    const normalized = normalizeKzPhone(phone);

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

    // randomInt, а не Math.random: код — это одноразовый пароль, и
    // предсказуемый генератор здесь равносилен отсутствию кода.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(
      CODE_DIGITS,
      '0',
    );
    await this.prisma.otpCode.create({
      data: {
        phone: normalized,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // Тестовые номера обслуживаем без SMS даже при живом провайдере:
    // проверять вход десять раз подряд за деньги незачем, а список
    // задаётся вручную и в бою пуст.
    if (testPhones(this.logger).has(normalized)) {
      this.logger.warn(`OTP для тестового номера ${normalized}: ${code}`);
      return { sent: true, devCode: code };
    }

    if (this.sms.configured) {
      try {
        await this.sms.sendOtp(normalized, code);
      } catch (error) {
        // Причину пишем в лог, клиенту не показываем: в тексте ошибки
        // провайдера бывает и остаток баланса, и номер счёта.
        this.logger.error(
          `SMS с кодом не отправлена на ${normalized}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new BadRequestException(
          'Не удалось отправить SMS. Попробуйте ещё раз через минуту',
        );
      }
      return { sent: true };
    }

    // Провайдер не настроен — только для локальной разработки
    if (process.env.OTP_DEV_MODE === '1') {
      this.logger.warn(`OTP для ${normalized}: ${code}`);
      return { sent: true };
    }
    this.logger.error('SMS-провайдер не настроен, а OTP_DEV_MODE выключен');
    throw new BadRequestException('Отправка SMS временно недоступна');
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
}
