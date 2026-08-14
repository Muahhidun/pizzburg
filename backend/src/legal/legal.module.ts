import { Global, Module } from '@nestjs/common';
import { LegalService } from './legal.service';
import { LegalController } from './legal.controller';

/// Глобальный: документы нужны публичному API, оформлению заказа и админке.
@Global()
@Module({
  providers: [LegalService],
  controllers: [LegalController],
  exports: [LegalService],
})
export class LegalModule {}
