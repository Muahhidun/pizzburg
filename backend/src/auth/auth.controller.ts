import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';

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

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Код должен состоять из 4 цифр' })
  code: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':tenantSlug/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post(':tenantSlug/verify')
  verify(@Param('tenantSlug') tenantSlug: string, @Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(tenantSlug, dto.phone, dto.code);
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
    const orders = await this.prisma.order.findMany({
      where: { customerId: req.customer.sub },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        total: true,
        createdAt: true,
        items: { select: { name: true, qty: true, price: true, isGift: true } },
      },
    });
    return { customer, orders };
  }
}
