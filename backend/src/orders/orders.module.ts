import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StatusPollerService } from './status-poller.service';

@Module({
  imports: [PosterModule, PromotionsModule],
  controllers: [OrdersController],
  providers: [OrdersService, StatusPollerService],
})
export class OrdersModule {}
