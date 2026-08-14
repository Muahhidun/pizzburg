import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { OptionalCustomerAuthGuard } from '../auth/optional-customer-auth.guard';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './orders.dto';
import { CancelReasonsService } from './cancel-reasons.service';
import { PrismaService } from '../prisma/prisma.service';

class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  /** Причина из справочника: без неё отчёт по отменам не построить */
  @IsOptional()
  @IsString()
  reasonId?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly reasons: CancelReasonsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':tenantSlug')
  @UseGuards(OptionalCustomerAuthGuard)
  create(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreateOrderDto,
    @Req() req: any,
  ) {
    return this.orders.createOrder(tenantSlug, dto, req.customer);
  }

  @Get('by-id/:orderId')
  get(@Param('orderId') orderId: string) {
    return this.orders.getOrder(orderId);
  }

  @Post('by-id/:orderId/sync-status')
  syncStatus(@Param('orderId') orderId: string) {
    return this.orders.syncStatus(orderId);
  }

  /** Отмена клиентом в окно, заданное арендатором */
  @Post('by-id/:orderId/cancel')
  @UseGuards(CustomerAuthGuard)
  cancel(
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
    @Req() req: any,
  ) {
    return this.orders.cancelByCustomer(
      orderId,
      req.customer.sub,
      dto.reason,
      dto.reasonId,
    );
  }

  /** Причины отмены, доступные клиенту */
  @Get(':tenantSlug/cancel-reasons')
  async cancelReasons(@Param('tenantSlug') tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    const reasons = await this.reasons.list(tenant.id, true);
    return reasons.map((r) => ({ id: r.id, label: r.label }));
  }
}
