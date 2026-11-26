import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryTaskKind, DeliveryTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { AssignmentService } from './assignment.service';
import { CourierSettings, courierSettings } from './courier-settings';
import { shortName } from './names';
import { orderOf } from './task-order';

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
  /// Порядок в связке: 2 — везут после первого
  batchSeq?: number | null;
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
  cfg: Pick<
    CourierSettings,
    'alertNoCourierAtMin' | 'alertNotReadyMin' | 'alertOnWayMin' | 'alertOnWaySecondMin'
  >,
  now = new Date(),
): TaskAlert | null {
  if (task.kind === 'PICKUP') return null;
  const min = (from: Date) => (now.getTime() - from.getTime()) / 60_000;
  const start = orderClockStart(task.order);
  if (start > now) return null;

  if (task.status === 'PICKED_UP') {
    const limit = onWayLimit(task, cfg);
    return task.pickedUpAt && min(task.pickedUpAt) >= limit ? 'ON_WAY' : null;
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

/** Через сколько минут после «Забрал» заказ «долго в пути»: второй в связке — позже */
export function onWayLimit(
  task: { batchSeq?: number | null },
  cfg: Pick<CourierSettings, 'alertOnWayMin' | 'alertOnWaySecondMin'>,
): number {
  return cfg.alertOnWayMin + (task.batchSeq === 2 ? cfg.alertOnWaySecondMin : 0);
}

@Injectable()
export class CourierAlertsService {
  private readonly logger = new Logger(CourierAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly assignment?: AssignmentService,
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
      await this.resolve();
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
          courier: { select: { fullName: true, phone: true, telegramUserId: true } },
        },
      });
      for (const raw of tasks) {
        // Заказ из Poster без нашего Order — время и номер из снимка
        const view = orderOf(raw);
        const t = {
          ...raw,
          order: { number: view.number, createdAt: view.createdAt, scheduledAt: view.scheduledAt },
        };
        const alert = taskAlert(t, ctx, cfg, now);
        if (!alert) continue;
        // Одна тревога каждого вида на заказ: иначе группа утонет в повторах
        const type = `ALERT_${alert}`;
        const already = await this.prisma.deliveryTaskEvent.findFirst({
          where: { taskId: t.id, type },
          select: { id: true },
        });
        if (already) continue;
        const event = await this.prisma.deliveryTaskEvent.create({
          data: { tenantId: v.tenantId, taskId: t.id, type, actor: 'SYSTEM' },
        });
        // Ссылки на номер ставим один раз: тот же текст потом дополняем итогом
        const text = await this.telegram.linkOrders(v.tenantId, alertText(alert, t, now));
        const sentTo = [
          await this.telegram.notifyCashier(v.tenantId, text, undefined, { links: false }),
          await this.telegram.notify(v.tenantId, text),
        ];
        const messages = sentTo
          .filter((r) => r.sent && r.chatId && r.messageId)
          .map((r) => ({ chatId: r.chatId!, messageId: r.messageId! }));
        if (messages.length) {
          const meta: AlertMeta = { text, messages };
          await this.prisma.deliveryTaskEvent.update({ where: { id: event.id }, data: { meta } });
        }
        if (alert === 'ON_WAY') await this.remindCourier(v.tenantId, t);
        sent++;
      }
    }
    return sent;
  }

  /**
   * «Долго в пути» часто значит, что заказ давно у клиента, а курьер не
   * протянул «Заказ доставлен» (Дом, 26.11.2026). Напоминаем ему самому —
   * кнопка открывает приложение.
   */
  private async remindCourier(
    tenantId: string,
    t: { order: { number: number | string }; courier?: { telegramUserId: string } | null },
  ) {
    if (!t.courier?.telegramUserId || !this.assignment) return;
    try {
      await this.assignment.sendToCourier(
        tenantId,
        t.courier.telegramUserId,
        `⏰ <b>№${t.order.number}: вы уже долго в пути</b>\n` +
          'Если заказ у клиента — откройте приложение и протяните «Заказ доставлен». ' +
          'Пока не отметите, касса считает, что вы его везёте.',
      );
    } catch (e) {
      this.logger.warn(`Напоминание курьеру о №${t.order.number} не ушло: ${e}`);
    }
  }

  /**
   * Итог тревоги — в то же сообщение (Дом, 26.11.2026: «потом видеть, когда
   * по итогу забрали / доставили»). Правим, а не шлём новое: в группе
   * остаётся одно сообщение на заказ, и в нём вся история — тревога и чем
   * кончилось.
   */
  async resolve(now = new Date()) {
    const events = await this.prisma.deliveryTaskEvent.findMany({
      where: {
        type: { in: ALERT_TYPES },
        at: { gt: new Date(now.getTime() - 12 * 60 * 60_000) },
        taskId: { not: null },
      },
      include: {
        task: {
          include: {
            order: { select: { number: true, createdAt: true, scheduledAt: true } },
            courier: { select: { fullName: true } },
          },
        },
      },
    });
    let done = 0;
    for (const e of events) {
      const meta = e.meta as AlertMeta | null;
      if (!meta?.messages?.length || meta.resolvedAt || !e.task) continue;
      const view = orderOf(e.task);
      const line = alertOutcome(e.type.replace('ALERT_', '') as TaskAlert, {
        ...e.task,
        order: { createdAt: view.createdAt, scheduledAt: view.scheduledAt },
      });
      if (!line) continue;
      for (const m of meta.messages) {
        const { error } = await this.telegram.call(e.tenantId, 'editMessageText', {
          chat_id: m.chatId,
          message_id: m.messageId,
          text: `${meta.text}\n\n${line}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        if (error) this.logger.warn(`Итог тревоги №${view.number} не дописан: ${error}`);
      }
      // Помечаем и при ошибке: иначе будем стучаться в Телеграм каждую минуту
      const next: AlertMeta = { ...meta, resolvedAt: now.toISOString(), outcome: line };
      await this.prisma.deliveryTaskEvent.update({ where: { id: e.id }, data: { meta: next } });
      done++;
    }
    return done;
  }
}

const ALERT_TYPES = ['ALERT_NO_COURIER', 'ALERT_NOT_READY', 'ALERT_ON_WAY'];

/** Что запомнили о тревоге: текст и куда ушла — чтобы дописать итог */
type AlertMeta = {
  text: string;
  messages: { chatId: string; messageId: number }[];
  resolvedAt?: string;
  outcome?: string;
};

const hm = (d: Date) =>
  d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
const minutes = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/**
 * Чем кончилась тревога. null — ещё не кончилась.
 * «Нет курьера» — когда курьер забрал; «курьер ждёт» — когда заказ готов;
 * «долго в пути» — когда доставлен.
 */
export function alertOutcome(
  alert: TaskAlert,
  t: {
    status: DeliveryTaskStatus;
    readyAt: Date | null;
    pickedUpAt: Date | null;
    deliveredAt: Date | null;
    failedReason?: string | null;
    order: { createdAt: Date; scheduledAt: Date | null };
    courier?: { fullName: string } | null;
  },
): string | null {
  if (t.status === 'CANCELLED') return '✖️ Заказ отменён';
  if (t.status === 'FAILED') {
    return `❌ Не доставлен${t.failedReason ? `: ${esc(t.failedReason)}` : ''}`;
  }
  const delivered = () =>
    t.deliveredAt
      ? `✅ Доставлен в ${hm(t.deliveredAt)}` +
        (t.pickedUpAt ? `, в пути ${minutes(t.pickedUpAt, t.deliveredAt)} мин` : '') +
        `, всего ${minutes(orderClockStart(t.order), t.deliveredAt)} мин`
      : null;
  switch (alert) {
    case 'NO_COURIER':
      if (t.pickedUpAt) {
        const who = t.courier ? esc(shortName(t.courier.fullName)) : 'Курьер';
        return `✅ ${who} забрал в ${hm(t.pickedUpAt)}, заказу было ${minutes(orderClockStart(t.order), t.pickedUpAt)} мин`;
      }
      return t.status === 'DELIVERED' ? delivered() : null;
    case 'NOT_READY':
      if (t.readyAt) return `✅ Готов в ${hm(t.readyAt)}`;
      return t.status === 'NEW' ? null : '✅ Готов';
    case 'ON_WAY':
      return t.status === 'DELIVERED' ? delivered() : null;
  }
}

export function alertText(
  alert: TaskAlert,
  t: AlertTask & {
    order: { number: number | string; createdAt: Date; scheduledAt: Date | null };
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
      const second = t.batchSeq === 2 ? ' (второй заказ в связке)' : '';
      return `🐢 <b>№${n} в пути уже ${on} мин</b>${second}\n${who}`;
    }
  }
}
