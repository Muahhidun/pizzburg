import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeKzPhone } from '../common/phone';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Вход по телефону + SMS-код. Телефон — идентификатор клиента (профили
 * переживут миграцию с FoodPicasso). SMS-провайдер подключается позже:
 * пока OTP_DEV_MODE=1 код пишется в лог и возвращается в ответе.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

    const code = String(Math.floor(1000 + Math.random() * 9000));
    await this.prisma.otpCode.create({
      data: {
        phone: normalized,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // TODO: SMS-провайдер (Mobizon и т.п.). До подключения — dev-режим.
    if (process.env.OTP_DEV_MODE === '1') {
      this.logger.warn(`OTP для ${normalized}: ${code}`);
      return { sent: true, devCode: code };
    }
    // сюда встанет вызов SMS-шлюза
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
