import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './orders.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':tenantSlug')
  create(@Param('tenantSlug') tenantSlug: string, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(tenantSlug, dto);
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
