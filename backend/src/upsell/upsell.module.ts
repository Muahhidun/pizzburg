import { Global, Module } from '@nestjs/common';
import { UpsellService } from './upsell.service';

/// Глобальный: список нужен и админке, и корзине.
@Global()
@Module({
  providers: [UpsellService],
  exports: [UpsellService],
})
export class UpsellModule {}
