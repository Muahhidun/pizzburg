import { Global, Module } from '@nestjs/common';
import { DisabledKaspiProvider } from './disabled-kaspi.provider';
import { KASPI_PAYMENT_PROVIDER } from './payment-provider';
import { PaymentsService } from './payments.service';
import { RefundRetryService } from './refund-retry.service';

/**
 * Глобальный финансовый модуль: отмены происходят из заказов, нехватки и
 * админки, и все они должны проходить через один идемпотентный сервис.
 */
@Global()
@Module({
  providers: [
    DisabledKaspiProvider,
    {
      provide: KASPI_PAYMENT_PROVIDER,
      useExisting: DisabledKaspiProvider,
    },
    PaymentsService,
    RefundRetryService,
  ],
  exports: [PaymentsService, KASPI_PAYMENT_PROVIDER],
})
export class PaymentsModule {}
