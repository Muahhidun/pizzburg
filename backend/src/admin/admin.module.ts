import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { PosterModule } from '../poster/poster.module';
import { StorageModule } from '../storage/storage.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { OrdersModule } from '../orders/orders.module';
import { MessagesModule } from '../messages/messages.module';
import { StopListModule } from '../stoplist/stoplist.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminStaffController } from './admin-staff.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { WoltDriveModule } from '../wolt-drive/wolt-drive.module';
import { CouriersModule } from '../couriers/couriers.module';
import { AdminDeliveryReportController, AdminDispatchController } from './admin-dispatch.controller';

@Module({
  imports: [
    PosterModule,
    StorageModule,
    LoyaltyModule,
    OrdersModule,
    PromotionsModule,
    MessagesModule,
    StopListModule,
    WoltDriveModule,
    CouriersModule,
  ],
  controllers: [
    AdminController,
    AdminAuthController,
    AdminStaffController,
    AdminDispatchController,
    AdminDeliveryReportController,
  ],
  providers: [AdminService, AdminGuard, AdminAuthService, AdminAuditService],
})
export class AdminModule {}
