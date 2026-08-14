import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PushPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LegalService } from '../legal/legal.service';
import { NotificationsService } from '../notifications/notifications.service';

class RequestOtpDto {
  @IsString()
  @MaxLength(24)
  @Matches(/^\+?[\d\s()-]{10,24}$/, { message: 'Неверный формат номера' })
  phone: string;
}

class VerifyOtpDto {
  @IsString()
  @MaxLength(24)
  @Matches(/^\+?[\d\s()-]{10,24}$/, { message: 'Неверный формат номера' })
  phone: string;

  // Диапазон, а не ровно шесть: коды, выданные до перехода на шестизначные,
  // должны доработать свои пять минут, а не отвалиться на валидации.
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'Код должен состоять из цифр' })
  code: string;
}

class PushTokenDto {
  @IsString()
  @MaxLength(4096)
  token: string;

  @IsIn(['IOS', 'ANDROID', 'WEB', 'UNKNOWN'])
  platform: PushPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly legal: LegalService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post(':tenantSlug/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('push-token')
  @UseGuards(CustomerAuthGuard)
  registerPushToken(@Req() req: any, @Body() dto: PushTokenDto) {
    return this.notifications.registerDevice(req.customer.sub, dto);
  }

  @Delete('push-token')
  @UseGuards(CustomerAuthGuard)
  unregisterPushToken(@Req() req: any, @Body() dto: PushTokenDto) {
    return this.notifications.unregisterDevice(req.customer.sub, dto.token);
  }

  @Post(':tenantSlug/verify')
  verify(@Param('tenantSlug') tenantSlug: string, @Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(tenantSlug, dto.phone, dto.code);
  }

  /** Обязательные документы, которых клиент ещё не принял */
  private async pendingConsent(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { legalVersions: true },
    });
    return this.legal.pendingConsent(tenantId, customer?.legalVersions);
  }

  /** Профиль + история заказов текущего клиента */
  @Get('me')
  @UseGuards(CustomerAuthGuard)
  async me(@Req() req: any) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: req.customer.sub },
      select: {
        id: true,
        phone: true,
        name: true,
        pointsBalance: true,
        loyaltyLevel: true,
      },
    });
    const [orders, loyaltyTransactions, tenant, consent] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId: req.customer.sub },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          total: true,
          pointsSpent: true,
          pointsEarned: true,
          createdAt: true,
          items: { select: { name: true, qty: true, price: true, isGift: true } },
        },
      }),
      this.prisma.loyaltyTransaction.findMany({
        where: { customerId: req.customer.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.tenant.findUnique({
        where: { id: req.customer.tenantId },
        select: { settings: true },
      }),
      this.pendingConsent(req.customer.sub, req.customer.tenantId),
    ]);
    return {
      customer,
      orders,
      loyaltyTransactions,
      loyalty: {
        cashbackPct: this.loyalty.cashbackPct(
          tenant?.settings ?? {},
          customer?.loyaltyLevel ?? 1,
        ),
      },
      // Каких редакций не хватает — решает сервер, а не приложение: клиент
      // не должен сам сравнивать номера версий, иначе новая редакция оферты
      // тихо разойдётся со старой сборкой.
      legal: { pending: consent },
    };
  }
}
