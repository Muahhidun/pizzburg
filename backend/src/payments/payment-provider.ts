export const KASPI_PAYMENT_PROVIDER = Symbol('KASPI_PAYMENT_PROVIDER');

export type ProviderPaymentStatus =
  | 'QR_TOKEN_CREATED'
  | 'WAIT'
  | 'PROCESSED'
  | 'ERROR';

export interface CreateProviderPaymentRequest {
  amount: number;
  externalId: string;
  channel: 'MOBILE_LINK' | 'WEB_QR';
  requestId: string;
}

export interface CreatedProviderPayment {
  providerPaymentId: string;
  status: 'QR_TOKEN_CREATED';
  expiresAt: Date;
  paymentMethods: string[];
  statusPollingIntervalSec: number;
  activationTimeoutSec: number;
  confirmationTimeoutSec: number;
  /** Возвращается клиенту, но намеренно не пишется в журнал событий. */
  paymentLink?: string;
  /** Возвращается клиенту, но намеренно не пишется в журнал событий. */
  qrToken?: string;
}

export interface ProviderPaymentState {
  status: ProviderPaymentStatus;
  transactionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RefundProviderPaymentRequest {
  providerPaymentId: string;
  amount: number;
  requestId: string;
}

export interface RefundedProviderPayment {
  providerRefundId: string;
}

/**
 * Граница между бизнес-логикой и Kaspi.
 *
 * Сертификат, mTLS, URL и особенности версии API будут только в реальной
 * реализации этого интерфейса. Модели заказов, отмена и админка от них не
 * зависят и уже сейчас тестируются через подменный провайдер.
 */
export interface PaymentProvider {
  createPayment(
    request: CreateProviderPaymentRequest,
  ): Promise<CreatedProviderPayment>;
  getPaymentStatus(
    providerPaymentId: string,
    requestId: string,
  ): Promise<ProviderPaymentState>;
  refundPayment(
    request: RefundProviderPaymentRequest,
  ): Promise<RefundedProviderPayment>;
}

export class PaymentProviderUnavailableError extends Error {
  constructor() {
    super('Kaspi ещё не настроен: требуется сертификат и доступ к API');
    this.name = 'PaymentProviderUnavailableError';
  }
}
