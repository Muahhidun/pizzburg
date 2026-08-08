import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { PosterModule } from '../poster/poster.module';
import { StorageModule } from '../storage/storage.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PosterModule, StorageModule, LoyaltyModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
