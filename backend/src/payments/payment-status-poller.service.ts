import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "./payments.service";

/**
 * Оплата не зависит от открытого экрана телефона.
 *
 * Клиент тоже опрашивает статус ради мгновенной обратной связи, но именно
 * сервер обязан увидеть Processed и открыть отправку в Poster, даже если
 * приложение выгрузили из памяти сразу после перехода в Kaspi.kz.
 */
@Injectable()
export class PaymentStatusPollerService {
  private readonly logger = new Logger(PaymentStatusPollerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  @Cron("*/5 * * * * *")
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const attempts = await this.prisma.paymentAttempt.findMany({
        where: { status: { in: ["CREATED", "QR_TOKEN_CREATED", "WAIT"] } },
        orderBy: { lastStatusAt: "asc" },
        take: 50,
        select: {
          id: true,
          lastStatusAt: true,
          statusPollingIntervalSec: true,
          providerPaymentId: true,
        },
      });
      for (const attempt of attempts) {
        if (!attempt.providerPaymentId) continue;
        const intervalMs = Math.max(
          3_000,
          Math.min(30_000, (attempt.statusPollingIntervalSec ?? 5) * 1_000),
        );
        if (
          attempt.lastStatusAt &&
          attempt.lastStatusAt.getTime() + intervalMs > now
        ) {
          continue;
        }
        try {
          await this.payments.syncPayment(attempt.id);
        } catch (error) {
          // Сетевой сбой не завершает платёж и не останавливает остальные.
          // Следующий тик повторит запрос с новым X-Request-ID.
          this.logger.warn(
            `Статус оплаты ${attempt.id} не обновлён: ${String(error)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
