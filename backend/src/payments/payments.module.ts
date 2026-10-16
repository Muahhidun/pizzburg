import { Global, Module } from "@nestjs/common";
import { DisabledKaspiProvider } from "./disabled-kaspi.provider";
import { KASPI_PAYMENT_PROVIDER } from "./payment-provider";
import { KaspiProvider, kaspiMode } from "./kaspi.provider";
import { PaymentsService } from "./payments.service";
import { RefundRetryService } from "./refund-retry.service";
import { PaymentsController } from "./payments.controller";
import { PaymentStatusPollerService } from "./payment-status-poller.service";

/**
 * Глобальный финансовый модуль: отмены происходят из заказов, нехватки и
 * админки, и все они должны проходить через один идемпотентный сервис.
 */
@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    DisabledKaspiProvider,
    ...(kaspiMode() === "disabled" ? [] : [KaspiProvider]),
    {
      provide: KASPI_PAYMENT_PROVIDER,
      useExisting:
        kaspiMode() === "disabled" ? DisabledKaspiProvider : KaspiProvider,
    },
    PaymentsService,
    RefundRetryService,
    PaymentStatusPollerService,
  ],
  exports: [PaymentsService, KASPI_PAYMENT_PROVIDER],
})
export class PaymentsModule {}
