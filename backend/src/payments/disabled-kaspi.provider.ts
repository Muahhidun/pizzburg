import { Injectable } from '@nestjs/common';
import {
  CreateProviderPaymentRequest,
  CreatedProviderPayment,
  PaymentProvider,
  PaymentProviderUnavailableError,
  ProviderPaymentState,
  RefundedProviderPayment,
  RefundProviderPaymentRequest,
} from './payment-provider';

/**
 * Безопасная реализация до получения сертификата.
 *
 * Она никогда не делает сетевых запросов и не может случайно провести
 * реальный платёж или возврат. Позже модуль заменит только этот provider.
 */
@Injectable()
export class DisabledKaspiProvider implements PaymentProvider {
  async createPayment(
    _request: CreateProviderPaymentRequest,
  ): Promise<CreatedProviderPayment> {
    throw new PaymentProviderUnavailableError();
  }

  async getPaymentStatus(
    _providerPaymentId: string,
    _requestId: string,
  ): Promise<ProviderPaymentState> {
    throw new PaymentProviderUnavailableError();
  }

  async refundPayment(
    _request: RefundProviderPaymentRequest,
  ): Promise<RefundedProviderPayment> {
    throw new PaymentProviderUnavailableError();
  }
}
