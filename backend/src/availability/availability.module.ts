import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';

/// Глобальный: правила приёма заказов нужны и заказам, и корзине,
/// и меню, и админке.
@Global()
@Module({
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
