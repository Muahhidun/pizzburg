import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { langFrom } from '../i18n/lang';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Prisma, PushPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LegalService } from '../legal/legal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AddressesService } from './addresses.service';

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

/**
 * Новый адрес из справочника города.
 *
 * Улица и дом обязательны и приходят из подсказок: свободный ввод
 * оставлен только для «моего адреса нет в списке», и он идёт отдельной
 * заявкой оператору, а не сюда.
 */
class SaveAddressDto {
  @IsString() @MaxLength(120) street: string;
  @IsString() @MaxLength(20) house: string;
  @IsOptional() @IsString() @MaxLength(20) flat?: string;
  @IsOptional() @IsString() @MaxLength(20) entrance?: string;
  @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
}

class RenameAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  /** ISO-дата; пустая строка означает «убрать» */
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4}-\d{2}-\d{2}.*)?$/, { message: 'Дата в формате ГГГГ-ММ-ДД' })
  birthday?: string;
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
    private readonly addresses: AddressesService,
  ) {}

  /**
   * Запрос кода — единственный маршрут, где каждая попытка стоит денег
   * (DECISIONS §12.26).
   *
   * Потолки на номер уже есть — минута между запросами и десять в сутки,
   * — но они не мешают перебирать чужие номера: тысяча разных номеров
   * укладывается в них полностью и сжигает баланс за ночь. Поэтому
   * отдельный потолок на источник запросов.
   */
  @Throttle({ short: { ttl: 60_000, limit: 3 }, long: { ttl: 3_600_000, limit: 10 } })
  @Post(':tenantSlug/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('push-token')
  @UseGuards(CustomerAuthGuard)
  registerPushToken(
    @Req() req: any,
    @Body() dto: PushTokenDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    // Язык берём из заголовка, а не из тела: он и так есть в каждом
    // запросе, и приложению не надо помнить, что его нужно послать
    // ещё и сюда после переключения языка (DECISIONS §12.30).
    return this.notifications.registerDevice(req.customer.sub, {
      ...dto,
      lang: langFrom(acceptLanguage),
    });
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

  /** Сохранённые адреса клиента — самые свежие сверху */
  @Get('addresses')
  @UseGuards(CustomerAuthGuard)
  listAddresses(@Req() req: any) {
    return this.addresses.list(req.customer.sub);
  }

  /**
   * Сохранить адрес до оформления заказа.
   *
   * Раньше адрес появлялся только вместе с заказом, и это делало
   * «добавить адрес» на главном экране невозможным: человек видел список
   * сохранённых, но пополнить его мог, лишь что-нибудь заказав.
   */
  @Post('addresses')
  @UseGuards(CustomerAuthGuard)
  addAddress(@Req() req: any, @Body() dto: SaveAddressDto) {
    return this.addresses.remember(req.customer.tenantId, req.customer.sub, dto);
  }

  @Delete('addresses/:id')
  @UseGuards(CustomerAuthGuard)
  removeAddress(@Req() req: any, @Param('id') id: string) {
    return this.addresses.remove(req.customer.sub, id);
  }

  @Patch('addresses/:id')
  @UseGuards(CustomerAuthGuard)
  renameAddress(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RenameAddressDto,
  ) {
    return this.addresses.rename(req.customer.sub, id, dto.label ?? null);
  }

  /** Профиль редактирует сам клиент: имя и дата рождения */
  @Patch('me')
  @UseGuards(CustomerAuthGuard)
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.prisma.customer.update({
      where: { id: req.customer.sub },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.birthday !== undefined
          ? { birthday: dto.birthday ? new Date(dto.birthday) : null }
          : {}),
      },
      select: { id: true, name: true, birthday: true },
    });
  }

  /// Баллы и уровень одним блоком: процент, название уровня, сколько
  /// осталось до следующего.
  private loyaltyBlock(settings: Prisma.JsonValue, lifetimeSpent: number) {
    const info = this.loyalty.levelFor(settings, lifetimeSpent);
    return {
      cashbackPct: info.current.cashbackPct,
      level: info.current.level,
      levelName: info.current.name,
      levelsTotal: info.total,
      lifetimeSpent,
      nextLevelName: info.next?.name ?? null,
      nextCashbackPct: info.next?.cashbackPct ?? null,
      toNextLevel: info.toNext,
    };
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
        lifetimeSpent: true,
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
      // Уровень считаем на сервере целиком: приложение не должно знать
      // пороги и заново их сравнивать — иначе старая сборка покажет
      // неверный процент после изменения лестницы.
      loyalty: this.loyaltyBlock(
        tenant?.settings ?? {},
        customer?.lifetimeSpent ?? 0,
      ),
      // Каких редакций не хватает — решает сервер, а не приложение: клиент
      // не должен сам сравнивать номера версий, иначе новая редакция оферты
      // тихо разойдётся со старой сборкой.
      legal: { pending: consent },
    };
  }
}
