import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OptionalCustomerAuthGuard } from '../auth/optional-customer-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './orders.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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
}
