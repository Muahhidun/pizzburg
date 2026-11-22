import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { adminBaseUrl, esc, TelegramService } from '../telegram/telegram.service';
import { courierSettings } from './courier-settings';

/**
 * Раздача заказов курьерам (docs/COURIER_SYSTEM_SPEC.md §6).
 *
 * Заказ назначается только в момент «Готов» и только тому, кто стоит в
 * очереди у раздачи: первым — курьеры из графика, внутри — по времени
 * скана «Я на месте». Курьер заказ не выбирает и не «перехватывает».
 *
 * Связки по два заказа будут отдельным шагом: им нужны координаты.
 */

const MAX_ASSIGN_PER_PASS = 20;

export function courierAppUrl(tenantSlug: string): string | null {
  const base = adminBaseUrl();
  return base ? `${base}/courier?t=${encodeURIComponent(tenantSlug)}` : null;
}

type Item = { name: string; qty: number; isUnavailable: boolean };

export function itemsLine(items: Item[]): string {
  return items
    .filter((i) => !i.isUnavailable)
    .map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name))
    .join(', ');
}

export function paymentLine(task: {
  cashToCollect: number;
  needsTerminal: boolean;
  changeFrom?: number | null;
}): string {
  if (task.cashToCollect > 0) {
    const change = task.changeFrom ? `, сдача с ${tenge(task.changeFrom)}` : '';
    return `Наличные ${tenge(task.cashToCollect)}${change}`;
  }
  if (task.needsTerminal) return 'Оплата картой: возьмите терминал';
  return 'Оплачен онлайн';
}

const tenge = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /** Раздать готовые заказы ожидающим курьерам точки. Возвращает число назначений */
  async assignVenue(venueId: string): Promise<number> {
    let assigned = 0;
    for (let i = 0; i < MAX_ASSIGN_PER_PASS; i++) {
      const task = await this.prisma.deliveryTask.findFirst({
        where: {
          venueId,
          status: 'READY',
          courierId: null,
          kind: { in: ['DELIVERY', 'EXTRA_TRIP'] },
        },
        orderBy: [{ readyAt: 'asc' }, { id: 'asc' }],
      });
      if (!task) break;
      const shift = await this.prisma.courierShift.findFirst({
        where: { venueId, endedAt: null, state: 'WAITING', courier: { status: 'ACTIVE' } },
        orderBy: [{ scheduled: 'desc' }, { queuedAt: 'asc' }],
      });
      if (!shift) break;

      const now = new Date();
      const ok = await this.prisma
        .$transaction(async (tx) => {
          // Оба шага условные: параллельный проход или нажатие могли
          // успеть раньше, тогда транзакция откатывается целиком
          const s = await tx.courierShift.updateMany({
            where: { id: shift.id, state: 'WAITING', endedAt: null },
            data: { state: 'ASSIGNED' },
          });
          const t = await tx.deliveryTask.updateMany({
            where: { id: task.id, status: 'READY', courierId: null },
            data: {
              status: 'ASSIGNED',
              courierId: shift.courierId,
              shiftId: shift.id,
              assignedAt: now,
            },
          });
          if (s.count === 0 || t.count === 0) throw new Error('RACE');
          await tx.deliveryTaskEvent.create({
            data: {
              tenantId: task.tenantId,
              taskId: task.id,
              shiftId: shift.id,
              courierId: shift.courierId,
              type: 'ASSIGNED',
              actor: 'SYSTEM',
            },
          });
          return true;
        })
        .catch((e) => {
          if (!(e instanceof Error && e.message === 'RACE')) throw e;
          return false;
        });
      if (!ok) continue;
      assigned++;
      await this.notifyAssigned(task.id);
    }
    return assigned;
  }

  /**
   * Снять назначение. `back` — куда вернуть заказ: в «Новый» (раздача
   * нажала «Отменить») или в «Готов» (курьер не пришёл за ним).
   */
  async unassign(
    taskId: string,
    reason: 'READY_UNDONE' | 'PICKUP_TIMEOUT',
    actor: string,
  ): Promise<boolean> {
    const task = await this.prisma.deliveryTask.findUnique({
      where: { id: taskId },
      include: { order: { select: { number: true } }, courier: true },
    });
    if (!task || task.status !== 'ASSIGNED' || !task.shiftId || !task.courierId) return false;

    const toNew = reason === 'READY_UNDONE';
    const ok = await this.prisma
      .$transaction(async (tx) => {
        const t = await tx.deliveryTask.updateMany({
          where: { id: taskId, status: 'ASSIGNED', courierId: task.courierId },
          data: {
            status: toNew ? 'NEW' : 'READY',
            readyAt: toNew ? null : task.readyAt,
            courierId: null,
            shiftId: null,
            assignedAt: null,
          },
        });
        if (t.count === 0) throw new Error('RACE');
        // Отбой от раздачи — не вина курьера: место в очереди сохраняется.
        // Не пришёл за заказом — выходит из очереди до нового скана.
        await tx.courierShift.updateMany({
          where: { id: task.shiftId!, state: 'ASSIGNED' },
          data: { state: toNew ? 'WAITING' : 'AWAY' },
        });
        await tx.deliveryTaskEvent.create({
          data: {
            tenantId: task.tenantId,
            taskId,
            shiftId: task.shiftId,
            courierId: task.courierId,
            type: reason,
            actor,
          },
        });
        return true;
      })
      .catch((e) => {
        if (!(e instanceof Error && e.message === 'RACE')) throw e;
        return false;
      });
    if (!ok) return false;

    const text = toNew
      ? `↩️ Отбой: №${task.order.number} ещё не собран. Вы остаётесь в очереди на своём месте.`
      : `⏰ №${task.order.number} передан другому курьеру: вы не отметили «Забрал». ` +
        'Вы вне очереди. Чтобы снова получать заказы, отсканируйте QR у раздачи.';
    await this.sendToCourier(task.tenantId, task.courier!.telegramUserId, text);
    return true;
  }

  /**
   * Раз в 30 секунд: не пришёл за заказом → заказ следующему; не вернулся
   * после доставки → вне очереди; и общий проход раздачи на случай, если
   * какое-то событие его не запустило.
   */
  @Cron('*/30 * * * * *')
  async housekeeping() {
    try {
      await this.sweep();
    } catch (e) {
      this.logger.error(`Курьерский проход: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async sweep(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({
      where: { dispatchDevices: { some: { isActive: true } } },
      select: { id: true, settings: true },
    });
    for (const tenant of tenants) {
      const cfg = courierSettings(tenant.settings);
      const late = await this.prisma.deliveryTask.findMany({
        where: {
          tenantId: tenant.id,
          status: 'ASSIGNED',
          assignedAt: { lt: new Date(now.getTime() - cfg.pickupTimeoutMin * 60_000) },
        },
        select: { id: true },
      });
      for (const t of late) await this.unassign(t.id, 'PICKUP_TIMEOUT', 'SYSTEM');

      const gone = await this.prisma.courierShift.findMany({
        where: {
          tenantId: tenant.id,
          endedAt: null,
          state: 'RETURNING',
          lastDeliveredAt: { lt: new Date(now.getTime() - cfg.returnWindowMin * 60_000) },
        },
        select: { id: true, courierId: true },
      });
      for (const s of gone) {
        const moved = await this.prisma.courierShift.updateMany({
          where: { id: s.id, state: 'RETURNING' },
          data: { state: 'AWAY' },
        });
        if (moved.count > 0) {
          await this.prisma.deliveryTaskEvent.create({
            data: { tenantId: tenant.id, shiftId: s.id, courierId: s.courierId, type: 'AWAY', actor: 'SYSTEM' },
          });
        }
      }
    }

    // Пауза кончилась — курьер снова в очереди на своём месте
    const rested = await this.prisma.courierShift.findMany({
      where: { endedAt: null, state: 'ON_PAUSE', pauseUntil: { lt: now } },
      select: { id: true },
    });
    for (const s of rested) await this.endPause(s.id, 'SYSTEM');

    const venues = await this.prisma.dispatchDevice.findMany({
      where: { isActive: true },
      select: { venueId: true },
      distinct: ['venueId'],
    });
    for (const { venueId } of venues) await this.assignVenue(venueId);
  }

  async endPause(shiftId: string, actor: string) {
    const shift = await this.prisma.courierShift.findUnique({
      where: { id: shiftId },
      include: { courier: { select: { telegramUserId: true } } },
    });
    if (!shift) return;
    const changed = await this.prisma.courierShift.updateMany({
      where: { id: shiftId, state: 'ON_PAUSE' },
      data: { state: 'WAITING', pauseUntil: null },
    });
    if (changed.count === 0) return;
    await this.prisma.deliveryTaskEvent.create({
      data: { tenantId: shift.tenantId, shiftId, courierId: shift.courierId, type: 'PAUSE_END', actor },
    });
    if (actor === 'SYSTEM') {
      await this.sendToCourier(
        shift.tenantId,
        shift.courier.telegramUserId,
        '⏱ Пауза закончилась, вы снова в очереди на своём месте.',
      );
    }
    await this.assignVenue(shift.venueId);
  }

  // ─── Сообщения курьеру ─────────────────────────────────────────

  private async notifyAssigned(taskId: string) {
    const task = await this.prisma.deliveryTask.findUnique({
      where: { id: taskId },
      include: {
        courier: { select: { telegramUserId: true } },
        tenant: { select: { slug: true } },
        order: {
          select: {
            number: true,
            changeFrom: true,
            items: { select: { name: true, qty: true, isUnavailable: true } },
          },
        },
      },
    });
    if (!task?.courier) return;
    const what =
      task.kind === 'EXTRA_TRIP'
        ? `Довоз: ${task.extraReason ?? 'без причины'}`
        : itemsLine(task.order.items);
    const text =
      `🛵 <b>Заберите ${task.kind === 'EXTRA_TRIP' ? 'довоз к ' : ''}№${task.order.number}</b>\n` +
      `${esc(what)}\n` +
      `${esc(paymentLine({ ...task, changeFrom: task.order.changeFrom }))}\n\n` +
      'Получите пакет на раздаче и отметьте «Забрал» со сканом QR.';
    await this.sendToCourier(task.tenantId, task.courier.telegramUserId, text, task.tenant.slug);
  }

  async sendToCourier(tenantId: string, chatId: string, text: string, tenantSlug?: string) {
    const slug =
      tenantSlug ??
      (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }))
        ?.slug;
    const url = slug ? courierAppUrl(slug) : null;
    const { error } = await this.telegram.call(tenantId, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url } }]] } } : {}),
    });
    if (error) this.logger.warn(`Курьеру ${chatId} не дошло: ${error}`);
  }
}
