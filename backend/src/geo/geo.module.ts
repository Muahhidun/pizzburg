import { Global, Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

/// Глобальный: подсказки понадобятся и оформлению, и админке зон доставки.
@Global()
@Module({
  providers: [GeoService],
  controllers: [GeoController],
  exports: [GeoService],
})
export class GeoModule {}
