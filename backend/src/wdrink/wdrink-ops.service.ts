import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { localDayStart } from '../orders/daily-summary.service';
import { WDRINK_KIND, wdrinkPartTotal } from './wdrink-dispatch';

const DEFAULT_TIMEZONE = 'Asia/Almaty';
/** Через сколько минут напоминаем кассе PizzBurg, что напитки не приняли */
export const WDRINK_REMIND_CASHIER_MIN = 5;
/** …и через сколько — руководству */
export const WDRINK_REMIND_OWNER_MIN = 10;

const tenge = (n: number) => `${n.toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`;

export interface SettlementOrder {
  number: number;
  paymentMethod: string;
  lines: { qty: number; price: number }[];
}

/** Текст «Отдать WeDrink» на конец смены */
export function settlementText(
  dateLabel: string,
  departmentName: string,
  orders: SettlementOrder[],
): string | null {
  if (orders.length === 0) return null;
  const byMethod = new Map<string, number>();
  let total = 0;
  for (const o of orders) {
    const sum = wdrinkPartTotal(o.lines);
    total += sum;
    byMethod.set(o.paymentMethod, (byMethod.get(o.paymentMethod) ?? 0) + sum);
  }
  const labels: Record<string, string> = {
    CASH: 'наличными у курьеров',
    KASPI_ONLINE: 'Kaspi онлайн',
    CARD_ON_DELIVERY: 'картой курьеру',
  };
  const lines = [...byMethod.entries()]
    .filter(([, sum]) => sum > 0)
    .map(([method, sum]) => `• ${labels[method] ?? method} — ${tenge(sum)}`);
  return (
    `🥤 <b>Расчёт с ${departmentName} за ${dateLabel}</b>\n` +
    `Отдать ${departmentName}: <b>${tenge(total)}</b> наличными\n` +
    `Заказов с напитками: ${orders.length}\n` +
    (lines.length ? `Как платили клиенты:\n${lines.join('\n')}` : '')
  ).trim();
}

/**
 * Касса WDrink как отдел: напоминание о непринятых напитках и вечерний
 * расчёт (DECISIONS §15).
 *
 * Обычное напоминание «заказ ждёт принятия» сюда не подходит: оно про
 * заказ целиком, а заказ считается принятым, как только принял основной
 * отдел. Напитки при этом могут так и висеть на кассе WeDrink.
 */
@Injectable()
export class WdrinkOpsService {
  private readonly logger = new Logger(WdrinkOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('*/1 * * * *')
  async remind(now = new Date()) {
    const parts = await this.prisma.orderDispatch.findMany({
      where: {
        status: 'SENT',
        acceptReminders: { lt: 2 },
        posterOrderId: { notIn: ['dry-run'] },
        OR: [{ posterStatus: null }, { posterStatus: 'NEW' }],
        sentAt: { lte: new Date(now.getTime() - WDRINK_REMIND_CASHIER_MIN * 60_000) },
        posterAccount: { kind: WDRINK_KIND },
        order: { status: { notIn: ['CANCELLED', 'DELIVERED'] } },
      },
      select: {
        id: true,
        sentAt: true,
        showAt: true,
        acceptReminders: true,
        posterAccount: { select: { name: true } },
        order: { select: { number: true, tenantId: true } },
      },
    });
    for (const d of parts) {
      // Предзаказ касса видит не с отправки, а с `showAt`
      const start = Math.max(d.sentAt!.getTime(), d.showAt?.getTime() ?? 0);
      const minutes = Math.floor((now.getTime() - start) / 60_000);
      if (minutes < WDRINK_REMIND_CASHIER_MIN) continue;
      const stage = minutes >= WDRINK_REMIND_OWNER_MIN ? 2 : 1;
      if (stage <= d.acceptReminders) continue;
      const claimed = await this.prisma.orderDispatch.updateMany({
        where: { id: d.id, acceptReminders: d.acceptReminders },
        data: { acceptReminders: stage },
      });
      if (claimed.count === 0) continue;
      const name = d.posterAccount.name;
      try {
        if (stage === 1) {
          await this.telegram.notifyCashier(
            d.order.tenantId,
            `⏰ <b>Напитки по заказу №${d.order.number} не приняты ${minutes} мин</b>\n` +
              `Касса ${name} не нажала «Принять». Загляните к ним.`,
          );
        } else {
          await this.telegram.notify(
            d.order.tenantId,
            `⏰ <b>Напитки по заказу №${d.order.number} не приняты уже ${minutes} мин</b>\n` +
              `Касса ${name} молчит — проверьте, на связи ли моноблок.`,
          );
        }
      } catch (e) {
        this.logger.warn(`Напоминание о напитках №${d.order.number} не ушло: ${e}`);
      }
    }
  }

  /** 21:30 — конец смены PizzBurg: сколько отдать WeDrink за день */
  @Cron('30 21 * * *', { timeZone: DEFAULT_TIMEZONE })
  async settle(now = new Date()) {
    const accounts = await this.prisma.posterAccount.findMany({
      where: { kind: WDRINK_KIND },
      select: { id: true, name: true, tenantId: true, tenant: { select: { settings: true } } },
    });
    for (const acc of accounts) {
      try {
        const timeZone = (acc.tenant?.settings as any)?.timezone ?? DEFAULT_TIMEZONE;
        const from = localDayStart(now, timeZone);
        const orders = await this.prisma.order.findMany({
          where: {
            tenantId: acc.tenantId,
            createdAt: { gte: from, lte: now },
            status: { not: 'CANCELLED' },
            dispatches: { some: { posterAccountId: acc.id, posterStatus: 'ACCEPTED' } },
          },
          orderBy: { number: 'asc' },
          select: {
            number: true,
            paymentMethod: true,
            items: {
              where: { isUnavailable: false, product: { posterAccountId: acc.id } },
              select: { qty: true, price: true },
            },
          },
        });
        const dateLabel = new Intl.DateTimeFormat('ru-RU', {
          timeZone,
          day: 'numeric',
          month: 'long',
        }).format(now);
        const text = settlementText(
          dateLabel,
          acc.name,
          orders.map((o) => ({ number: o.number, paymentMethod: o.paymentMethod, lines: o.items })),
        );
        if (text) await this.telegram.notifyCashier(acc.tenantId, text);
      } catch (e) {
        this.logger.warn(`Расчёт с ${acc.name} не отправлен: ${e}`);
      }
    }
  }
}
