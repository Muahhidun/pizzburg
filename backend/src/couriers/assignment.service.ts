import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { adminBaseUrl, esc, TelegramService } from '../telegram/telegram.service';
import { pickHolder, Point, secondNow, streetHouseOf } from './batching';
import { courierSettings } from './courier-settings';
import { byLateness, deadlineAt, dueAt, externalOf, externalPaymentLine, orderOf } from './task-order';

/**
 * Раздача заказов курьерам (docs/COURIER_SYSTEM_SPEC.md §6).
 *
 * Заказ назначается только в момент «Готов» и только тому, кто стоит в
 * очереди у раздачи: первым — курьеры из графика, внутри — по времени
 * скана «Я на месте». Курьер заказ не выбирает и не «перехватывает».
 *
 * Готовые заказы раздаются по опозданию: первым — тот, что оформлен
 * раньше (предзаказ — по времени клиента), а не тот, что раньше собран.
 *
 * Связки по два заказа (§6.4): когда свободных курьеров не осталось,
 * готовый заказ добавляется вторым тому, кто ещё стоит у раздачи со своим
 * заказом, — если ждать курьера, который едет назад, значит опоздать
 * (`secondNow`). По умолчанию в любую сторону (`batchAnyDirection`), иначе —
 * только если оба адреса в одну сторону (batching.ts).
 */

const ORDER_TIMES = { select: { number: true, address: true, createdAt: true, scheduledAt: true } } as const;

/** Почему курьера сняли с назначенного заказа */
export type ReleaseReason = 'PICKUP_TIMEOUT' | 'COURIER_LEFT';

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
    private readonly geo: GeoService,
  ) {}

  /** Раздать готовые заказы ожидающим курьерам точки. Возвращает число назначений */
  async assignVenue(venueId: string, at: Date = new Date()): Promise<number> {
    let assigned = 0;
    for (let i = 0; i < MAX_ASSIGN_PER_PASS; i++) {
      const ready = await this.prisma.deliveryTask.findMany({
        where: {
          venueId,
          status: 'READY',
          courierId: null,
          kind: { in: ['DELIVERY', 'EXTRA_TRIP'] },
        },
        include: { order: ORDER_TIMES },
      });
      const task = byLateness(ready)[0];
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
    // Свободных курьеров не осталось — оставшиеся готовые заказы пробуем
    // добавить вторыми тем, кто ещё стоит у раздачи
    assigned += await this.attachSeconds(venueId, at.getTime());
    return assigned;
  }

  /**
   * Связки: готовый заказ без курьера → вторым тому, кто ещё у раздачи
   * (назначен, но не протянул «Поехали») с одним заказом. Самые опоздавшие
   * заказы — первыми. Зовётся только когда свободных курьеров в очереди
   * нет: при свободном курьере заказ быстрее увезти отдельно.
   */
  private async attachSeconds(venueId: string, now: number): Promise<number> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        address: true,
        lat: true,
        lng: true,
        tenant: { select: { slug: true, settings: true } },
      },
    });
    if (!venue) return 0;
    const cfg = courierSettings(venue.tenant.settings);
    if (cfg.batchMaxDetourKm <= 0) return 0;

    const ready = byLateness(
      await this.prisma.deliveryTask.findMany({
        where: { venueId, status: 'READY', courierId: null, kind: 'DELIVERY' },
        include: { order: ORDER_TIMES },
      }),
    );
    if (ready.length === 0) return 0;

    const shifts = await this.prisma.courierShift.findMany({
      where: { venueId, endedAt: null, state: 'ASSIGNED', courier: { status: 'ACTIVE' } },
      orderBy: { queuedAt: 'asc' },
      include: {
        tasks: {
          where: { status: { in: ['ASSIGNED', 'PICKED_UP'] } },
          include: { order: ORDER_TIMES },
        },
      },
    });
    const holders = shifts.filter(
      (s) =>
        s.tasks.length === 1 &&
        s.tasks[0].status === 'ASSIGNED' &&
        s.tasks[0].kind === 'DELIVERY' &&
        !s.tasks[0].batchId,
    );
    if (holders.length === 0) return 0;

    const slug = venue.tenant.slug;
    const venuePoint = await this.venuePoint(slug, venue);
    // Без точки раздачи «в одну сторону» не измерить
    if (!venuePoint && !cfg.batchAnyDirection) return 0;

    const free = await Promise.all(
      holders.map(async (s) => ({
        shift: s,
        task: s.tasks[0],
        point: await this.pointOf(slug, orderOf(s.tasks[0]).address),
      })),
    );
    // Кто скоро будет у раздачи: ждёт или отвёз и едет назад. Каждый такой
    // курьер «занимается» самым опоздавшим заказом, который решили ему оставить
    const coming = (
      await this.prisma.courierShift.findMany({
        where: { venueId, endedAt: null, state: { in: ['WAITING', 'RETURNING'] }, courier: { status: 'ACTIVE' } },
        select: { state: true, lastDeliveredAt: true },
      })
    )
      .map((s) =>
        s.state === 'RETURNING' && s.lastDeliveredAt
          ? s.lastDeliveredAt.getTime() + cfg.etaReturnMin * 60_000
          : now,
      )
      .sort((a, b) => a - b);

    let attached = 0;
    for (const second of ready) {
      if (free.length === 0) break;
      const decision = secondNow(now, deadlineAt(second, cfg.deliveryTargetMin), coming[0] ?? null, cfg);
      if (!decision.give) {
        coming.shift();
        continue;
      }
      const point = await this.pointOf(slug, orderOf(second).address);
      const best = pickHolder(venuePoint, point, free, cfg.batchMaxDetourKm, cfg.batchAnyDirection);
      if (!best) continue;
      const holder = best.item;
      if (await this.attach(holder.shift.id, holder.shift.courierId, holder.task, second, best.detourKm)) {
        attached++;
        const at = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        this.logger.log(
          `Связка: №${orderOf(second).number} вторым к №${orderOf(holder.task).number}` +
            (best.detourKm == null ? ' (без координат)' : ` (крюк ${best.detourKm.toFixed(1)} км)`) +
            `; срок ${at(deadlineAt(second, cfg.deliveryTargetMin))}, так ~${at(decision.viaHolder)}` +
            (decision.viaNext == null ? ', следующего курьера нет' : `, со следующим ~${at(decision.viaNext)}`),
        );
        await this.notifyAssigned(second.id);
      }
      free.splice(free.indexOf(holder), 1);
    }
    return attached;
  }

  private async attach(
    shiftId: string,
    courierId: string,
    first: { id: string; tenantId: string; createdAt?: Date; order?: { number: number; createdAt: Date } | null; external?: unknown },
    second: { id: string; createdAt?: Date; order?: { number: number; createdAt: Date } | null; external?: unknown },
    detourKm: number | null,
  ): Promise<boolean> {
    // Первым везут более опоздавший заказ
    const firstGoesFirst = dueAt(first) <= dueAt(second);
    const batchId = first.id;
    return this.prisma
      .$transaction(async (tx) => {
        const a = await tx.deliveryTask.updateMany({
          where: { id: first.id, status: 'ASSIGNED', courierId, batchId: null },
          data: { batchId, batchSeq: firstGoesFirst ? 1 : 2 },
        });
        const b = await tx.deliveryTask.updateMany({
          where: { id: second.id, status: 'READY', courierId: null },
          data: {
            status: 'ASSIGNED',
            courierId,
            shiftId,
            assignedAt: new Date(),
            batchId,
            batchSeq: firstGoesFirst ? 2 : 1,
          },
        });
        if (a.count === 0 || b.count === 0) throw new Error('RACE');
        await tx.deliveryTaskEvent.create({
          data: {
            tenantId: first.tenantId,
            taskId: second.id,
            shiftId,
            courierId,
            type: 'ASSIGNED',
            actor: 'SYSTEM',
            meta: {
              batchWith: first.id,
              detourKm: detourKm == null ? null : Math.round(detourKm * 100) / 100,
            },
          },
        });
        return true;
      })
      .catch((e) => {
        if (!(e instanceof Error && e.message === 'RACE')) throw e;
        return false;
      });
  }

  /** Точка раздачи: свои координаты или дом из справочника по адресу */
  private async venuePoint(
    tenantSlug: string,
    venue: { address: string; lat: number | null; lng: number | null },
  ): Promise<Point | null> {
    if (venue.lat != null && venue.lng != null) return { lat: venue.lat, lng: venue.lng };
    const sh = streetHouseOf(venue.address);
    return sh ? this.geo.coordsOf(tenantSlug, sh.street, sh.house).catch(() => null) : null;
  }

  /** Точка адреса заказа: свои координаты или справочник по улице и дому */
  async pointOf(tenantSlug: string, raw: unknown): Promise<Point | null> {
    const a = (raw ?? {}) as { street?: string; house?: string; lat?: unknown; lng?: unknown };
    if (typeof a.lat === 'number' && typeof a.lng === 'number') return { lat: a.lat, lng: a.lng };
    if (!a.street || !a.house) return null;
    return this.geo.coordsOf(tenantSlug, a.street, a.house).catch(() => null);
  }

  /**
   * Снять заказ с курьера, который ещё у раздачи. Не вина курьера — место
   * в очереди сохраняется. Если у него связка, второй заказ остаётся за ним
   * как одиночный.
   * - `READY_UNDONE` — «Отменить» сразу после «Готов»: заказ обратно в «Новый»;
   * - `CANCELLED` — заказ отменён (клиент передумал): плитка закрывается.
   */
  async unassign(taskId: string, reason: 'READY_UNDONE' | 'CANCELLED', actor: string): Promise<boolean> {
    const task = await this.prisma.deliveryTask.findUnique({
      where: { id: taskId },
      include: { order: { select: { number: true } }, courier: true },
    });
    if (!task || task.status !== 'ASSIGNED' || !task.shiftId || !task.courierId) return false;

    const ok = await this.prisma
      .$transaction(async (tx) => {
        const t = await tx.deliveryTask.updateMany({
          where: { id: taskId, status: 'ASSIGNED', courierId: task.courierId },
          data: {
            ...(reason === 'CANCELLED' ? { status: 'CANCELLED' } : { status: 'NEW', readyAt: null }),
            courierId: null,
            shiftId: null,
            assignedAt: null,
            batchId: null,
            batchSeq: null,
          },
        });
        if (t.count === 0) throw new Error('RACE');
        const rest = task.batchId
          ? await tx.deliveryTask.updateMany({
              where: { batchId: task.batchId, courierId: task.courierId },
              data: { batchId: null, batchSeq: null },
            })
          : { count: 0 };
        if (rest.count === 0) {
          await tx.courierShift.updateMany({
            where: { id: task.shiftId!, state: 'ASSIGNED' },
            data: { state: 'WAITING' },
          });
        }
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

    await this.sendToCourier(
      task.tenantId,
      task.courier!.telegramUserId,
      reason === 'CANCELLED'
        ? `❌ №${orderOf(task).number} отменён, забирать не нужно. ` +
            (task.batchId ? 'Второй заказ по-прежнему ваш.' : 'Вы остаётесь в очереди на своём месте.')
        : task.batchId
          ? `↩️ Отбой: №${orderOf(task).number} ещё не собран. Второй заказ по-прежнему ваш.`
          : `↩️ Отбой: №${orderOf(task).number} ещё не собран. Вы остаётесь в очереди на своём месте.`,
    );
    return true;
  }

  /**
   * Курьер вне очереди: не пришёл за заказом (`PICKUP_TIMEOUT`, нарушение)
   * или раздача отметила «Уехал» (`COURIER_LEFT`, без нарушения — например,
   * повёз заказ из старого приложения). Назначенные, но не забранные заказы
   * возвращаются в «Готов» и сразу уходят следующему. Уже забранные остаются
   * у курьера. Вернётся — отсканирует QR и встанет в конец очереди.
   *
   * Возвращает номера снятых заказов или null, если менять было нечего.
   */
  async releaseShift(shiftId: string, reason: ReleaseReason, actor: string): Promise<string[] | null> {
    const shift = await this.prisma.courierShift.findUnique({
      where: { id: shiftId },
      include: {
        courier: { select: { telegramUserId: true } },
        tasks: {
          where: { status: 'ASSIGNED' },
          include: { order: { select: { number: true } } },
        },
      },
    });
    if (!shift || shift.endedAt) return null;
    const carrying = await this.prisma.deliveryTask.count({
      where: { shiftId, status: 'PICKED_UP' },
    });
    // Везёт заказ — он и так не в очереди; вернётся сканом
    if (carrying > 0 && shift.tasks.length === 0) return null;
    if (shift.state === 'AWAY' && shift.tasks.length === 0) return null;

    const released = await this.prisma.$transaction(async (tx) => {
      const numbers: string[] = [];
      for (const t of shift.tasks) {
        const changed = await tx.deliveryTask.updateMany({
          where: { id: t.id, status: 'ASSIGNED', courierId: shift.courierId },
          data: {
            status: 'READY',
            courierId: null,
            shiftId: null,
            assignedAt: null,
            batchId: null,
            batchSeq: null,
          },
        });
        if (changed.count === 0) continue;
        numbers.push(orderOf(t).number);
        await tx.deliveryTaskEvent.create({
          data: {
            tenantId: shift.tenantId,
            taskId: t.id,
            shiftId,
            courierId: shift.courierId,
            type: reason,
            actor,
          },
        });
      }
      // С забранным заказом курьер в пути, а не вне смены
      if (carrying === 0) {
        await tx.courierShift.updateMany({
          where: { id: shiftId, endedAt: null },
          data: { state: 'AWAY', pauseUntil: null },
        });
        if (reason === 'COURIER_LEFT') {
          await tx.deliveryTaskEvent.create({
            data: { tenantId: shift.tenantId, shiftId, courierId: shift.courierId, type: 'AWAY', actor },
          });
        }
      }
      return numbers;
    });

    const list = released.map((n) => `№${n}`).join(' и ');
    const text =
      reason === 'PICKUP_TIMEOUT'
        ? `⏰ ${list} ${released.length > 1 ? 'переданы' : 'передан'} другому курьеру: вы не отметили «Забрал». ` +
          'Вы вне очереди. Чтобы снова получать заказы, отсканируйте QR у раздачи.'
        : (released.length > 0
            ? `${list} ${released.length > 1 ? 'переданы' : 'передан'} другому курьеру. `
            : '') +
          '🚗 Раздача отметила, что вы уехали: вы вне очереди. ' +
          'Вернётесь — отсканируйте QR у раздачи, и снова начнут приходить заказы.';
    if (reason === 'COURIER_LEFT' || released.length > 0) {
      await this.sendToCourier(shift.tenantId, shift.courier.telegramUserId, text);
    }
    if (released.length > 0) await this.assignVenue(shift.venueId);
    return released;
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
        select: { shiftId: true },
      });
      // Связка уходит целиком: заказы одного курьера снимаем вместе
      const lateShifts = [...new Set(late.map((t) => t.shiftId).filter((id): id is string => !!id))];
      for (const id of lateShifts) await this.releaseShift(id, 'PICKUP_TIMEOUT', 'SYSTEM');

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
    for (const { venueId } of venues) await this.assignVenue(venueId, now);
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
            createdAt: true,
            changeFrom: true,
            items: { select: { name: true, qty: true, isUnavailable: true } },
          },
        },
      },
    });
    if (!task?.courier) return;
    const view = orderOf(task);
    const what =
      task.kind === 'EXTRA_TRIP'
        ? `Довоз: ${task.extraReason ?? 'без причины'}`
        : itemsLine(view.items);
    const ext = externalOf(task.external);
    const pay = ext
      ? externalPaymentLine(ext)
      : paymentLine({ ...task, changeFrom: view.changeFrom });
    const partner = task.batchId
      ? await this.prisma.deliveryTask.findFirst({
          where: { batchId: task.batchId, id: { not: task.id }, courierId: task.courierId },
          select: { external: true, order: { select: { number: true, createdAt: true } } },
        })
      : null;
    const title = partner
      ? `➕ <b>Ещё заказ по пути: №${view.number}</b>`
      : `🛵 <b>Заберите ${task.kind === 'EXTRA_TRIP' ? 'довоз к ' : ''}№${view.number}</b>`;
    const order = partner
      ? task.batchSeq === 1
        ? `Везёте два заказа: сначала №${view.number}, потом №${orderOf(partner).number}.`
        : `Везёте два заказа: сначала №${orderOf(partner).number}, потом №${view.number}.`
      : '';
    const text =
      `${title}\n` +
      `${esc(what)}\n` +
      `${esc(pay)}\n\n` +
      (order ? `${order}\n` : '') +
      (partner
        ? 'Заберите оба пакета, отметьте позиции и протяните «Поехали» со сканом QR.'
        : 'Получите пакет на раздаче и отметьте «Забрал» со сканом QR.');
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
