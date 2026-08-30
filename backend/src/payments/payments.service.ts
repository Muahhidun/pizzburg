import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  PaymentAttemptStatus,
  PaymentChannel,
  PaymentRefundStatus,
} from '@prisma/client';
import { AvailabilityService } from '../availability/availability.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  KASPI_PAYMENT_PROVIDER,
  PaymentProvider,
  ProviderPaymentState,
} from './payment-provider';

/** Тот же технический буфер, что у отправки обычного заказа в Poster. */
export const PAYMENT_DISPATCH_BUFFER_MS = 10_000;

/** После этого автоматические попытки останавливаются, но запись не теряется. */
export const MAX_AUTOMATIC_REFUND_ATTEMPTS = 8;

/**
 * Экспоненциальная пауза: 1, 2, 4… минут, максимум час.
 * Экспортирована для теста — ошибка в формуле означала бы лавину в Kaspi.
 */
export function refundRetryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  return Math.min(60, 2 ** exponent) * 60_000;
}

type RefundActor = 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    @Inject(KASPI_PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
  ) {}

  /**
   * Создаёт попытку оплаты и вызывает провайдер.
   *
   * Публичного маршрута пока нет: Kaspi всё ещё скрыт в приложении. Метод
   * уже готов для будущего контроллера и полностью изолирован provider-ом.
   */
  async createKaspiPayment(orderId: string, channel: PaymentChannel) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        number: true,
        total: true,
        paymentMethod: true,
        paymentStatus: true,
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.paymentMethod !== 'KASPI_ONLINE') {
      throw new BadRequestException('Для заказа не выбрана оплата Kaspi');
    }
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Заказ уже оплачен');
    }

    const active = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderId,
        status: { in: ['CREATED', 'QR_TOKEN_CREATED', 'WAIT'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return this.paymentSummary(active.id);

    const externalId = `${order.id}:${randomUUID()}`;
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        provider: 'KASPI',
        channel,
        amount: order.total,
        externalId,
      },
    });
    await this.event(attempt.id, 'PAYMENT_CREATED');

    const requestId = randomUUID();
    try {
      const created = await this.provider.createPayment({
        amount: order.total,
        externalId,
        channel,
        requestId,
      });
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'QR_TOKEN_CREATED',
          providerPaymentId: created.providerPaymentId,
          expiresAt: created.expiresAt,
          paymentMethods: created.paymentMethods,
          statusPollingIntervalSec: created.statusPollingIntervalSec,
          activationTimeoutSec: created.activationTimeoutSec,
          confirmationTimeoutSec: created.confirmationTimeoutSec,
          lastStatusAt: new Date(),
        },
      });
      await this.event(attempt.id, 'PROVIDER_PAYMENT_CREATED', {
        requestId,
        providerStatus: created.status,
      });
      return {
        ...(await this.paymentSummary(attempt.id)),
        paymentLink: created.paymentLink,
        qrToken: created.qrToken,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'ERROR', errorMessage: message, lastStatusAt: new Date() },
      });
      await this.event(attempt.id, 'PROVIDER_CREATE_FAILED', {
        requestId,
        providerStatus: 'ERROR',
        metadata: { message },
      });
      throw error;
    }
  }

  async syncPayment(attemptId: string) {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Попытка оплаты не найдена');
    if (!attempt.providerPaymentId) {
      throw new BadRequestException('Kaspi ещё не вернул идентификатор оплаты');
    }
    if (['PROCESSED', 'ERROR', 'EXPIRED'].includes(attempt.status)) {
      return this.paymentSummary(attempt.id);
    }

    const requestId = randomUUID();
    const state = await this.provider.getPaymentStatus(
      attempt.providerPaymentId,
      requestId,
    );
    await this.applyProviderState(attempt.id, state, requestId);
    return this.paymentSummary(attempt.id);
  }

  /**
   * Вызывается при любой отмене заказа. Для наличных/карты это быстрый
   * no-op; для подтверждённого Kaspi создаёт возврат оставшейся суммы.
   */
  async refundCancelledOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        paymentMethod: true,
        paymentStatus: true,
        cancelledBy: true,
        cancelReason: true,
      },
    });
    if (!order || order.paymentMethod !== 'KASPI_ONLINE') return null;
    if (order.paymentStatus === 'PENDING' || order.paymentStatus === 'REFUNDED') {
      return null;
    }
    return this.requestRefund({
      orderId,
      tenantId: order.tenantId,
      requestedBy:
        order.cancelledBy === 'CUSTOMER'
          ? 'CUSTOMER'
          : order.cancelledBy === 'ADMIN'
            ? 'ADMIN'
            : 'SYSTEM',
      reason: order.cancelReason ?? 'Отмена заказа',
      idempotencyKey: `order-cancel:${order.id}`,
      // Клиент не должен ждать сетевой таймаут Kaspi, чтобы увидеть саму
      // отмену. PENDING уже сохранён, вызов стартует сразу и подхватится
      // кроном после рестарта.
      processImmediately: false,
    });
  }

  async requestRefund(input: {
    orderId: string;
    tenantId: string;
    requestedBy: RefundActor;
    reason?: string;
    amount?: number;
    idempotencyKey: string;
    processImmediately?: boolean;
  }) {
    const reservation = await this.reserveRefund(input);
    if (!reservation.created) {
      // Процесс мог упасть между записью PENDING и сетевым вызовом.
      // Повтор того же HTTP-запроса безопасно продолжает ровно эту запись.
      if (reservation.refund.status !== 'PENDING') return reservation.refund;
      return this.processOrQueue(
        reservation.refund,
        input.processImmediately !== false,
      );
    }
    await this.event(reservation.paymentAttemptId, 'REFUND_REQUESTED', {
      refundId: reservation.refund.id,
      metadata: {
        amount: reservation.refund.amount,
        requestedBy: input.requestedBy,
      },
    });
    return this.processOrQueue(
      reservation.refund,
      input.processImmediately !== false,
    );
  }

  /** Повтор из админки после исчерпания автоматических попыток. */
  async retryRefund(refundId: string, tenantId: string) {
    const refund = await this.prisma.paymentRefund.findFirst({
      where: { id: refundId, tenantId },
    });
    if (!refund) throw new NotFoundException('Возврат не найден');
    if (refund.status === 'SUCCEEDED') return refund;
    if (refund.status !== 'FAILED') {
      throw new BadRequestException(
        'Ручной повтор доступен только после остановки автоматических попыток',
      );
    }
    await this.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: { status: 'PENDING', nextRetryAt: null, lastError: null },
    });
    return this.processRefund(refund.id);
  }

  async processRefund(refundId: string) {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      include: { paymentAttempt: true },
    });
    if (!refund) throw new NotFoundException('Возврат не найден');
    if (refund.status === 'SUCCEEDED') return refund;
    if (refund.status === 'PROCESSING') return refund;

    if (!refund.paymentAttempt.providerPaymentId) {
      const failed = await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          lastError: 'У оплаты отсутствует идентификатор Kaspi',
          nextRetryAt: null,
        },
      });
      await this.refreshOrderRefundStatus(refund.orderId);
      return failed;
    }

    // Атомарно забираем операцию себе. На Railway может одновременно
    // работать несколько контейнеров; простой find+update отправил бы два
    // возврата. У Kaspi refund-метод не принимает ExternalId, поэтому
    // внутренняя блокировка обязательна.
    const claimed = await this.prisma.paymentRefund.updateMany({
      where: {
        id: refund.id,
        status: { in: ['PENDING', 'RETRY_PENDING'] },
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        nextRetryAt: null,
        lastError: null,
      },
    });
    if (claimed.count === 0) {
      return this.prisma.paymentRefund.findUniqueOrThrow({
        where: { id: refund.id },
      });
    }
    const processing = await this.prisma.paymentRefund.findUniqueOrThrow({
      where: { id: refund.id },
      include: { paymentAttempt: true },
    });
    const attemptCount = processing.attemptCount;
    await this.refreshOrderRefundStatus(processing.orderId);

    const requestId = randomUUID();
    try {
      const result = await this.provider.refundPayment({
        providerPaymentId: processing.paymentAttempt.providerPaymentId!,
        amount: processing.amount,
        requestId,
      });
      const succeeded = await this.prisma.paymentRefund.update({
        where: { id: processing.id },
        data: {
          status: 'SUCCEEDED',
          providerRefundId: result.providerRefundId,
          completedAt: new Date(),
          nextRetryAt: null,
          lastError: null,
        },
      });
      await this.event(processing.paymentAttemptId, 'REFUND_SUCCEEDED', {
        refundId: processing.id,
        requestId,
        metadata: { amount: processing.amount },
      });
      await this.refreshOrderRefundStatus(processing.orderId);
      return succeeded;
    } catch (error) {
      const message = this.errorMessage(error);
      const automaticRetriesExhausted =
        attemptCount >= MAX_AUTOMATIC_REFUND_ATTEMPTS;
      const failed = await this.prisma.paymentRefund.update({
        where: { id: processing.id },
        data: {
          status: automaticRetriesExhausted ? 'FAILED' : 'RETRY_PENDING',
          lastError: message,
          nextRetryAt: automaticRetriesExhausted
            ? null
            : new Date(Date.now() + refundRetryDelayMs(attemptCount)),
        },
      });
      await this.event(processing.paymentAttemptId, 'REFUND_FAILED', {
        refundId: processing.id,
        requestId,
        metadata: { attemptCount, willRetry: !automaticRetriesExhausted },
      });
      await this.refreshOrderRefundStatus(processing.orderId);
      this.logger.warn(
        `Возврат ${processing.id} не выполнен, попытка ${attemptCount}: ${message}`,
      );
      return failed;
    }
  }

  async orderPayment(orderId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        number: true,
        paymentMethod: true,
        paymentStatus: true,
        paidAt: true,
        cancelUntil: true,
        paymentAttempts: {
          orderBy: { createdAt: 'desc' },
          include: {
            refunds: { orderBy: { createdAt: 'desc' } },
            events: { orderBy: { createdAt: 'desc' }, take: 30 },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  async retryDueRefunds(now = new Date()) {
    const due = await this.prisma.paymentRefund.findMany({
      where: {
        OR: [
          // PENDING остаётся после рестарта между записью и вызовом API.
          { status: 'PENDING' },
          { status: 'RETRY_PENDING', nextRetryAt: { lte: now } },
        ],
      },
      select: { id: true },
      take: 50,
      orderBy: { nextRetryAt: 'asc' },
    });
    for (const refund of due) await this.processRefund(refund.id);
    return due.length;
  }

  private async applyProviderState(
    attemptId: string,
    state: ProviderPaymentState,
    requestId: string,
  ) {
    const status = state.status as PaymentAttemptStatus;
    const attempt = await this.prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        providerTransactionId: state.transactionId,
        errorCode: state.errorCode,
        errorMessage: state.errorMessage,
        lastStatusAt: new Date(),
        ...(status === 'PROCESSED' ? { processedAt: new Date() } : {}),
      },
      include: { order: { include: { tenant: { select: { settings: true } } } } },
    });
    await this.event(attemptId, 'PAYMENT_STATUS_CHANGED', {
      requestId,
      providerStatus: state.status,
    });

    if (status === 'PROCESSED') {
      const now = new Date();
      const windowMinutes = this.availability.getState(
        attempt.order.tenant.settings,
        now,
      ).cancellation.customerWindowMinutes;
      const cancelUntil =
        windowMinutes > 0
          ? new Date(now.getTime() + windowMinutes * 60_000)
          : null;
      const cancelled = attempt.order.status === 'CANCELLED';
      await this.prisma.order.update({
        where: { id: attempt.orderId },
        data: {
          paymentStatus: 'PAID',
          paidAt: now,
          cancelUntil: cancelled ? null : cancelUntil,
          dispatchAfter: cancelled
            ? null
            : cancelUntil
              ? new Date(cancelUntil.getTime() + PAYMENT_DISPATCH_BUFFER_MS)
              : now,
        },
      });
      // Редкая гонка: клиент отменил ещё ожидающую оплату, а подтверждение
      // пришло следом. Заказ не оживает и не едет в Poster — деньги сразу
      // ставятся на возврат.
      if (cancelled) await this.refundCancelledOrder(attempt.orderId);
    }
  }

  private async refreshOrderRefundStatus(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { total: true, paymentRefunds: true },
    });
    if (!order) return;
    const succeeded = order.paymentRefunds
      .filter((refund) => refund.status === 'SUCCEEDED')
      .reduce((sum, refund) => sum + refund.amount, 0);
    const pending = order.paymentRefunds.some((refund) =>
      ['PENDING', 'PROCESSING', 'RETRY_PENDING'].includes(refund.status),
    );
    const failed = order.paymentRefunds.some(
      (refund) => refund.status === 'FAILED',
    );
    const paymentStatus =
      succeeded >= order.total
        ? 'REFUNDED'
        : pending
          ? 'REFUND_PENDING'
          : failed
            ? 'REFUND_FAILED'
            : succeeded > 0
              ? 'PARTIALLY_REFUNDED'
              : 'PAID';
    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus },
    });
  }

  /**
   * Проверка остатка и создание возврата идут в SERIALIZABLE-транзакции.
   * Иначе два разных клика с разными idempotencyKey одновременно увидят
   * один и тот же остаток и вместе вернут больше суммы заказа.
   */
  private async reserveRefund(input: {
    orderId: string;
    tenantId: string;
    requestedBy: RefundActor;
    reason?: string;
    amount?: number;
    idempotencyKey: string;
    processImmediately?: boolean;
  }) {
    for (let transactionAttempt = 1; transactionAttempt <= 3; transactionAttempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const order = await tx.order.findFirst({
              where: { id: input.orderId, tenantId: input.tenantId },
              include: {
                paymentAttempts: {
                  where: { status: 'PROCESSED' },
                  orderBy: { processedAt: 'desc' },
                  take: 1,
                },
                paymentRefunds: true,
              },
            });
            if (!order) throw new NotFoundException('Заказ не найден');
            if (
              order.paymentMethod !== 'KASPI_ONLINE' ||
              order.paymentStatus === 'PENDING'
            ) {
              throw new BadRequestException(
                'У заказа нет подтверждённой оплаты Kaspi',
              );
            }
            const payment = order.paymentAttempts[0];
            if (!payment) {
              throw new BadRequestException(
                'Не найдена подтверждённая операция Kaspi',
              );
            }

            const existing = order.paymentRefunds.find(
              (refund) =>
                refund.paymentAttemptId === payment.id &&
                refund.idempotencyKey === input.idempotencyKey,
            );
            if (existing) {
              return {
                refund: existing,
                paymentAttemptId: payment.id,
                created: false as const,
              };
            }

            const reserved = order.paymentRefunds
              .filter((refund) =>
                // FAILED тоже резервирует сумму: сетевой таймаут мог
                // случиться после фактического возврата у Kaspi. Пока
                // оператор не сверил операцию, второй возврат опасен.
                [
                  'PENDING',
                  'PROCESSING',
                  'RETRY_PENDING',
                  'SUCCEEDED',
                  'FAILED',
                ].includes(refund.status),
              )
              .reduce((sum, refund) => sum + refund.amount, 0);
            const available = Math.max(0, order.total - reserved);
            const amount = input.amount ?? available;
            if (!Number.isInteger(amount) || amount <= 0) {
              throw new BadRequestException(
                'Сумма возврата должна быть больше нуля',
              );
            }
            if (amount > available) {
              throw new BadRequestException(
                `Доступно к возврату не больше ${available} ₸`,
              );
            }

            const refund = await tx.paymentRefund.create({
              data: {
                tenantId: order.tenantId,
                orderId: order.id,
                paymentAttemptId: payment.id,
                amount,
                requestedBy: input.requestedBy,
                reason: input.reason?.slice(0, 300),
                idempotencyKey: input.idempotencyKey,
              },
            });
            return {
              refund,
              paymentAttemptId: payment.id,
              created: true as const,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code);
        if (!retryable || transactionAttempt === 3) throw error;
      }
    }
    throw new Error('Не удалось зарезервировать сумму возврата');
  }

  private processOrQueue<T extends { id: string }>(refund: T, immediate: boolean) {
    if (immediate) return this.processRefund(refund.id);
    void this.processRefund(refund.id).catch((error) =>
      this.logger.error(
        `Не удалось запустить возврат ${refund.id}; запись PENDING подхватит крон: ${String(error)}`,
      ),
    );
    return Promise.resolve(refund);
  }

  private async paymentSummary(attemptId: string) {
    return this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: {
        id: true,
        orderId: true,
        channel: true,
        status: true,
        amount: true,
        currency: true,
        expiresAt: true,
        paymentMethods: true,
        statusPollingIntervalSec: true,
        activationTimeoutSec: true,
        confirmationTimeoutSec: true,
        processedAt: true,
        errorCode: true,
        errorMessage: true,
      },
    });
  }

  private async event(
    paymentAttemptId: string,
    kind: string,
    input?: {
      refundId?: string;
      requestId?: string;
      providerStatus?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.prisma.paymentEvent.create({
      data: {
        paymentAttemptId,
        kind,
        refundId: input?.refundId,
        requestId: input?.requestId,
        providerStatus: input?.providerStatus,
        metadata: (input?.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  }
}
