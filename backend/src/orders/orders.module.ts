import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StatusPollerService } from './status-poller.service';
import { CancelReasonsService } from './cancel-reasons.service';
import { ShortageService } from './shortage.service';
import { ServiceReceiptService } from './service-receipt.service';
import { AuthModule } from '../auth/auth.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PosterModule,
    PromotionsModule,
    AuthModule,
    LoyaltyModule,
    NotificationsModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    StatusPollerService,
    CancelReasonsService,
    ShortageService,
    ServiceReceiptService,
  ],
  exports: [
    OrdersService,
    CancelReasonsService,
    ShortageService,
    ServiceReceiptService,
  ],
})
export class OrdersModule {}
