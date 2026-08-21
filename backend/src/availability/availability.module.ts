import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { RushService } from './rush.service';

/// Глобальный: правила приёма заказов нужны и заказам, и корзине,
/// и меню, и админке.
@Global()
@Module({
  providers: [AvailabilityService, RushService],
  exports: [AvailabilityService, RushService],
})
export class AvailabilityModule {}
