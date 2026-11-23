import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { TelegramService } from "../telegram/telegram.service";
import { moneyLine } from "./orders.service";

const DEFAULT_TIMEZONE = "Asia/Almaty";

/// Причину клиент пишет сам; угловая скобка сломала бы HTML телеграма.
const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Начало текущих суток в часовом поясе заведения. */
export function localDayStart(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed =
    (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) *
      1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}

type SummaryOrder = {
  number: number;
  status: string;
  total: number;
  paymentMethod: string;
  paidAt: Date | null;
  cancelledBy: string | null;
  cancelledByName?: string | null;
  cancelReason: string | null;
  paymentRefunds: { amount: number; idempotencyKey: string }[];
};

type SummaryRefund = {
  amount: number;
  status: string;
  order: { number: number };
};

/// Кто отменил — словами для группы
const WHO: Record<string, string> = {
  CUSTOMER: "отменил клиент",
  ADMIN: "отменил сотрудник",
  POSTER: "отклонили на планшете",
  SYSTEM: "не оплатил Kaspi",
  AUTO: "не приняли за 3 часа",
};
const whoOf = (by: string | null) => WHO[by ?? ""] ?? "кто отменил — не записано";

function plural(n: number) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return "заказ";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "заказа";
  return "заказов";
}

/** Текст сводки. Отдельно от крона — чтобы проверять без базы и часов. */
export function buildDailySummary(
  orders: SummaryOrder[],
  refunds: SummaryRefund[],
  dateLabel: string,
) {
  const done = orders.filter((o) => o.status !== "CANCELLED");
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const revenue = done.reduce((sum, o) => sum + o.total, 0);
  // Все оплаченные через Kaspi, включая отменённые потом: деньги
  // поступили, и с выпиской Kaspi Pay сверяется именно эта сумма.
  const kaspiPaid = orders.filter(
    (o) => o.paymentMethod === "KASPI_ONLINE" && o.paidAt,
  );
  const kaspiIn = kaspiPaid.reduce((sum, o) => sum + o.total, 0);
  const kaspiBack = refunds
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((sum, r) => sum + r.amount, 0);

  const lines = [
    `📊 <b>Итоги дня — ${dateLabel}</b>`,
    `Заказов: ${done.length} на ${revenue} ₸`,
  ];
  if (kaspiPaid.length || kaspiBack) {
    lines.push(
      `Kaspi онлайн (приложение): ${kaspiPaid.length} ${plural(kaspiPaid.length)} на ${kaspiIn} ₸, ` +
        `возвращено ${kaspiBack} ₸` +
        (kaspiBack ? `, итого ${kaspiIn - kaspiBack} ₸` : ""),
    );
  }

  if (cancelled.length === 0) {
    lines.push("Отмен не было");
  } else {
    const byWho = new Map<string, number>();
    for (const o of cancelled) {
      const who = whoOf(o.cancelledBy);
      byWho.set(who, (byWho.get(who) ?? 0) + 1);
    }
    lines.push(
      "",
      `🚫 <b>Отмен: ${cancelled.length}</b>`,
      ...[...byWho].map(([who, n]) => `   ${who}: ${n}`),
    );
    for (const o of cancelled) {
      const money = moneyLine(o).replace(/^\n/, "").replace(/<\/?b>/g, "");
      lines.push(
        `• №${o.number}, ${o.total} ₸ — ${whoOf(o.cancelledBy)}` +
          (o.cancelledByName ? ` ${escapeHtml(o.cancelledByName)}` : "") +
          (o.cancelReason ? `, причина: «${escapeHtml(o.cancelReason)}»` : "") +
          (money ? `. ${money}` : ""),
      );
    }
  }

  const ok = refunds.filter((r) => r.status === "SUCCEEDED");
  const waiting = refunds.filter((r) =>
    ["PENDING", "PROCESSING", "RETRY_PENDING"].includes(r.status),
  );
  const failed = refunds.filter((r) => r.status === "FAILED");
  if (refunds.length > 0) {
    lines.push("", `💸 <b>Возвраты на Kaspi</b>`);
    if (ok.length) {
      lines.push(
        `Вернули: ${ok.length} на ${ok.reduce((s, r) => s + r.amount, 0)} ₸`,
      );
    }
    if (waiting.length) {
      lines.push(
        `В процессе: ` +
          waiting.map((r) => `№${r.order.number} (${r.amount} ₸)`).join(", "),
      );
    }
    if (failed.length) {
      lines.push(
        `❗️ Не прошли, нужно «Повторить» в админке: ` +
          failed.map((r) => `№${r.order.number} (${r.amount} ₸)`).join(", "),
      );
    }
  }
  return lines.join("\n");
}

/**
 * Вечерняя сводка руководству после закрытия смены (21:30).
 *
 * В админке постоянно никто не сидит, а отдельные сообщения за день
 * легко пропустить. Здесь всё важное разом: сколько заказов, кто и почему
 * отменял, что с деньгами Kaspi и какие возвраты требуют вмешательства.
 */
@Injectable()
export class DailySummaryService {
  private readonly logger = new Logger(DailySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron("30 21 * * *", { timeZone: DEFAULT_TIMEZONE })
  async send(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, settings: true },
    });
    for (const tenant of tenants) {
      try {
        const timeZone =
          (tenant.settings as any)?.timezone ?? DEFAULT_TIMEZONE;
        const from = localDayStart(now, timeZone);
        const [orders, refunds] = await Promise.all([
          this.prisma.order.findMany({
            where: { tenantId: tenant.id, createdAt: { gte: from, lte: now } },
            orderBy: { number: "asc" },
            select: {
              number: true,
              status: true,
              total: true,
              paymentMethod: true,
              paidAt: true,
              cancelledBy: true,
              cancelledByName: true,
              cancelReason: true,
              paymentRefunds: {
                select: { amount: true, idempotencyKey: true },
              },
            },
          }),
          this.prisma.paymentRefund.findMany({
            where: {
              tenantId: tenant.id,
              OR: [
                { createdAt: { gte: from, lte: now } },
                // Зависший с прошлых дней возврат тоже надо видеть
                { status: { in: ["FAILED", "RETRY_PENDING"] } },
              ],
            },
            select: {
              amount: true,
              status: true,
              order: { select: { number: true } },
            },
          }),
        ]);
        // Тихий день без заказов — не повод писать.
        if (orders.length === 0 && refunds.length === 0) continue;
        const dateLabel = new Intl.DateTimeFormat("ru-RU", {
          timeZone,
          day: "numeric",
          month: "long",
        }).format(now);
        await this.telegram.notify(
          tenant.id,
          buildDailySummary(orders as SummaryOrder[], refunds, dateLabel),
        );
      } catch (error) {
        this.logger.warn(`Сводка дня не отправлена: ${String(error)}`);
      }
    }
  }
}
