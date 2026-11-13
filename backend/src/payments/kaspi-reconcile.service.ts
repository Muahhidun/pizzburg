import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TelegramService } from "../telegram/telegram.service";
import { PaymentsService, ReconcileFinding } from "./payments.service";

/**
 * Ежедневная сверка с Kaspi — после закрытия смены (21:30) и вечерней
 * сводки, чтобы поймать и возвраты, сделанные кассиром в тот же день.
 */
@Injectable()
export class KaspiReconcileService {
  private readonly logger = new Logger(KaspiReconcileService.name);

  constructor(
    private readonly payments: PaymentsService,
    @Optional() private readonly telegram?: TelegramService,
  ) {}

  @Cron("0 22 * * *", { timeZone: "Asia/Almaty" })
  async run() {
    const result = await this.payments.reconcileKaspiPayments();
    if (result.checked || result.failed) {
      this.logger.log(
        `Сверка Kaspi: проверено ${result.checked}, не удалось ${result.failed}, расхождений ${result.findings.length}`,
      );
    }
    const byTenant = new Map<string, ReconcileFinding[]>();
    for (const finding of result.findings) {
      byTenant.set(finding.tenantId, [
        ...(byTenant.get(finding.tenantId) ?? []),
        finding,
      ]);
    }
    for (const [tenantId, findings] of byTenant) {
      await this.telegram?.notify(tenantId, reconcileMessage(findings));
    }
    // Если Kaspi не ответил ни по одной покупке, руководство должно знать:
    // молчание сверки иначе выглядело бы как «всё сходится».
    if (result.failed > 0 && result.checked === 0) {
      this.logger.error("Сверка Kaspi не проверила ни одной покупки");
    }
  }
}

export function reconcileMessage(findings: ReconcileFinding[]) {
  const external = findings.filter((f) => f.kind === "EXTERNAL");
  const mismatch = findings.filter((f) => f.kind === "MISMATCH");
  const lines = ["🔎 <b>Сверка с Kaspi</b>"];
  if (external.length) {
    lines.push(
      "",
      "Деньги вернули в Kaspi Pay, мимо админки. Записал возвраты к заказам:",
      ...external.map((f) => `• №${f.orderNumber} — ${f.amount} ₸`),
    );
  }
  if (mismatch.length) {
    lines.push(
      "",
      "❗️ У нас возвратов больше, чем видит Kaspi. Проверьте вручную:",
      ...mismatch.map((f) => `• №${f.orderNumber} — разница ${f.amount} ₸`),
    );
  }
  lines.push("", "Возвраты делайте через админку: так клиент получит уведомление.");
  return lines.join("\n");
}
