import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { RushService } from './rush.service';
import { OrderingService } from './ordering.service';

/// Глобальный: правила приёма заказов нужны и заказам, и корзине,
/// и меню, и админке.
@Global()
@Module({
  providers: [AvailabilityService, RushService, OrderingService],
  exports: [AvailabilityService, RushService, OrderingService],
})
export class AvailabilityModule {}
