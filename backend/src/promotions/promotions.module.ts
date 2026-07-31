import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CartController } from './cart.controller';

@Module({
  providers: [PromotionsService],
  controllers: [CartController],
  exports: [PromotionsService],
})
export class PromotionsModule {}
