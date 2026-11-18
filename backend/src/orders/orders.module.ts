import { DailySummaryService } from './daily-summary.service';
import { UnpaidOrdersService } from './unpaid-orders.service';
import { Module } from '@nestjs/common';
import { PosterModule } from '../poster/poster.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StatusPollerService } from './status-poller.service';
import { AcceptReminderService } from './accept-reminder.service';
import { CancelReasonsService } from './cancel-reasons.service';
import { ShortageService } from './shortage.service';
import { ServiceReceiptService } from './service-receipt.service';
import { OrderMessagesService } from './order-messages.service';
import {
  TelegramRepliesController,
  TelegramRepliesService,
  TelegramWebhookBootstrap,
} from './telegram-replies.controller';
import { ReviewsService } from './reviews.service';
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
  controllers: [OrdersController, TelegramRepliesController],
  providers: [
    OrdersService,
    StatusPollerService,
    AcceptReminderService,
    UnpaidOrdersService,
    DailySummaryService,
    CancelReasonsService,
    ShortageService,
    ServiceReceiptService,
    OrderMessagesService,
    ReviewsService,
    TelegramRepliesService,
    TelegramWebhookBootstrap,
  ],
  exports: [
    OrdersService,
    CancelReasonsService,
    ShortageService,
    ServiceReceiptService,
    OrderMessagesService,
    ReviewsService,
  ],
})
export class OrdersModule {}
