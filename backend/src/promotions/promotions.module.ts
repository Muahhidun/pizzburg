import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CartController } from './cart.controller';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [LoyaltyModule],
  providers: [PromotionsService],
  controllers: [CartController],
  exports: [PromotionsService],
})
export class PromotionsModule {}
