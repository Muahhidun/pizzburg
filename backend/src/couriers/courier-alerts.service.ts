import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryTaskKind, DeliveryTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { CourierSettings, courierSettings } from './courier-settings';
import { shortName } from './names';

/**
 * Тревоги (docs/COURIER_SYSTEM_SPEC.md §11).
 *
 * Правило одно и для Telegram, и для подсветки плитки на планшете, поэтому
 * оно — чистая функция. Ожидание курьера без заказов тревогой не считается:
 * утром курьер может час сидеть без доставок, и это нормально.
 */

export type TaskAlert = 'NO_COURIER' | 'NOT_READY' | 'ON_WAY';

export interface AlertTask {
  kind: DeliveryTaskKind;
  status: DeliveryTaskStatus;
  createdAt: Date;
  pickedUpAt: Date | null;
  order: { createdAt: Date; scheduledAt: Date | null };
}

/** Предзаказ считаем «оформленным» за час до нужного времени */
const PREORDER_LEAD_MS = 60 * 60_000;

export function orderClockStart(order: { createdAt: Date; scheduledAt: Date | null }): Date {
  if (!order.scheduledAt) return order.createdAt;
  const lead = new Date(order.scheduledAt.getTime() - PREORDER_LEAD_MS);
  return lead > order.createdAt ? lead : order.createdAt;
}

export function taskAlert(
  task: AlertTask,
  ctx: { waitingCouriers: number; firstWaitingSince: Date | null },
  cfg: Pick<CourierSettings, 'alertNoCourierAtMin' | 'alertNotReadyMin' | 'alertOnWayMin'>,
  now = new Date(),
): TaskAlert | null {
  if (task.kind === 'PICKUP') return null;
  const min = (from: Date) => (now.getTime() - from.getTime()) / 60_000;
  const start = orderClockStart(task.order);
  if (start > now) return null;

  if (task.status === 'PICKED_UP') {
    return task.pickedUpAt && min(task.pickedUpAt) >= cfg.alertOnWayMin ? 'ON_WAY' : null;
  }
  if (task.status === 'NEW' && ctx.waitingCouriers > 0 && ctx.firstWaitingSince) {
    // От более позднего: появился заказ или пришёл курьер
    const since = ctx.firstWaitingSince > task.createdAt ? ctx.firstWaitingSince : task.createdAt;
    if (min(since) >= cfg.alertNotReadyMin) return 'NOT_READY';
  }
  if ((task.status === 'NEW' || task.status === 'READY') && ctx.waitingCouriers === 0) {
    if (min(start) >= cfg.alertNoCourierAtMin) return 'NO_COURIER';
  }
  return null;
}

@Injectable()
export class CourierAlertsService {
  private readonly logger = new Logger(CourierAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /** Очередь точки: сколько ждут и с какого времени ждёт первый */
  async venueContext(venueId: string) {
    const waiting = await this.prisma.courierShift.findMany({
      where: { venueId, endedAt: null, state: 'WAITING' },
      select: { queuedAt: true },
      orderBy: { queuedAt: 'asc' },
    });
    return { waitingCouriers: waiting.length, firstWaitingSince: waiting[0]?.queuedAt ?? null };
  }

  @Cron('15 * * * * *')
  async tick() {
    try {
      await this.check();
    } catch (e) {
      this.logger.error(`Тревоги курьеров: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async check(now = new Date()) {
    const venues = await this.prisma.dispatchDevice.findMany({
      where: { isActive: true },
      select: { venueId: true, tenantId: true, tenant: { select: { settings: true } } },
      distinct: ['venueId'],
    });
    let sent = 0;
    for (const v of venues) {
      const cfg = courierSettings(v.tenant.settings);
      const ctx = await this.venueContext(v.venueId);
      const tasks = await this.prisma.deliveryTask.findMany({
        where: {
          venueId: v.venueId,
          kind: { in: ['DELIVERY', 'EXTRA_TRIP'] },
          status: { in: ['NEW', 'READY', 'PICKED_UP'] },
          createdAt: { gt: new Date(now.getTime() - 12 * 60 * 60_000) },
        },
        include: {
          order: { select: { number: true, createdAt: true, scheduledAt: true } },
          courier: { select: { fullName: true, phone: true } },
        },
      });
      for (const t of tasks) {
        const alert = taskAlert(t, ctx, cfg, now);
        if (!alert) continue;
        // Одна тревога каждого вида на заказ: иначе группа утонет в повторах
        const type = `ALERT_${alert}`;
        const already = await this.prisma.deliveryTaskEvent.findFirst({
          where: { taskId: t.id, type },
          select: { id: true },
        });
        if (already) continue;
        await this.prisma.deliveryTaskEvent.create({
          data: { tenantId: v.tenantId, taskId: t.id, type, actor: 'SYSTEM' },
        });
        const text = alertText(alert, t, now);
        await this.telegram.notifyCashier(v.tenantId, text);
        await this.telegram.notify(v.tenantId, text);
        sent++;
      }
    }
    return sent;
  }
}

export function alertText(
  alert: TaskAlert,
  t: AlertTask & {
    order: { number: number; createdAt: Date; scheduledAt: Date | null };
    courier?: { fullName: string; phone: string | null } | null;
  },
  now = new Date(),
): string {
  const n = t.order.number;
  const age = Math.floor((now.getTime() - orderClockStart(t.order).getTime()) / 60_000);
  switch (alert) {
    case 'NO_COURIER':
      return (
        `🚨 <b>№${n}: заказу ${age} мин, а свободных курьеров нет</b>\n` +
        'Доставка может опоздать. Позовите курьера.'
      );
    case 'NOT_READY':
      return (
        `⏳ <b>№${n}: курьер ждёт, а заказ всё ещё в «Новом»</b>\n` +
        'Кухня не успевает или раздача не нажала «Готов» на планшете.'
      );
    case 'ON_WAY': {
      const on = t.pickedUpAt ? Math.floor((now.getTime() - t.pickedUpAt.getTime()) / 60_000) : 0;
      const who = t.courier
        ? `${esc(shortName(t.courier.fullName))}${t.courier.phone ? `, ${t.courier.phone}` : ''}`
        : 'курьер';
      return `🐢 <b>№${n} в пути уже ${on} мин</b>\n${who}`;
    }
  }
}
