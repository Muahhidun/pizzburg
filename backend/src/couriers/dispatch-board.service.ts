import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { esc, TelegramService } from '../telegram/telegram.service';
import { Cron } from '@nestjs/schedule';
import { DeliveryTaskStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentService } from './assignment.service';
import { taskAlert } from './courier-alerts.service';
import { courierSettings } from './courier-settings';
import { DispatchDeviceValue, hashDeviceToken } from './dispatch-device.guard';
import { createQrToken } from './dispatch-qr';
import { shortName } from './names';

/**
 * Планшет раздачи (docs/COURIER_SYSTEM_SPEC.md §4).
 *
 * Заказ появляется плиткой, как только кассир принял его в Poster.
 * Раздача собирает пакет со всех кухонь и одним нажатием отмечает
 * «Готов». Это единственное действие раздачи; дальше заказ ведут
 * курьер и система.
 *
 * Этапы 1–3 не трогают Order.status: клиент ничего нового не видит.
 */

/** Сколько секунд после «Готов» раздача может нажать «Отменить» */
export const READY_UNDO_SEC = 15;
/** Сколько висит доставленный или выданный заказ, прежде чем исчезнуть */
const DONE_VISIBLE_MS = 5 * 60_000;
/** Старше этого заказ на доске не показываем: он явно закрыт вне системы */
const BOARD_HORIZON_MS = 12 * 60 * 60_000;

const ACTIVE: DeliveryTaskStatus[] = ['NEW', 'READY', 'ASSIGNED', 'PICKED_UP'];
const DONE: DeliveryTaskStatus[] = ['DELIVERED', 'HANDED_OVER', 'FAILED'];

type Modifier = { name?: string };

@Injectable()
export class DispatchBoardService {
  private readonly logger = new Logger(DispatchBoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: AssignmentService,
    private readonly telegram: TelegramService,
  ) {}

  // ─── Задачи из заказов ─────────────────────────────────────────

  /**
   * Раз в 15 секунд: новые принятые заказы → плитки, отменённые → убрать.
   *
   * Крон, а не вызов из OrdersService: принятие приходит опросом Poster
   * раз в минуту, так что точности хватает, а заказы остаются нетронутыми.
   * Только для точек, где висит активный планшет: без планшета задачи
   * никому не нужны.
   */
  @Cron('*/15 * * * * *')
  async syncFromOrders() {
    try {
      const venues = await this.prisma.dispatchDevice.findMany({
        where: { isActive: true },
        select: { venueId: true },
        distinct: ['venueId'],
      });
      for (const { venueId } of venues) await this.syncVenue(venueId);
    } catch (e) {
      this.logger.error(`Синхронизация плиток: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async syncVenue(venueId: string, now = new Date()) {
    const since = new Date(now.getTime() - BOARD_HORIZON_MS);
    const fresh = await this.prisma.order.findMany({
      where: {
        venueId,
        createdAt: { gt: since },
        // Принят на планшете Poster; дальше статусы ставит этот модуль
        status: { in: ['ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
        deliveryTasks: { none: { kind: { in: ['DELIVERY', 'PICKUP'] } } },
      },
      select: { id: true, tenantId: true, type: true, paymentMethod: true, total: true },
    });
    if (fresh.length > 0) {
      await this.prisma.deliveryTask.createMany({
        data: fresh.map((o) => ({
          tenantId: o.tenantId,
          venueId,
          orderId: o.id,
          kind: o.type === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
          cashToCollect: o.type === 'DELIVERY' && o.paymentMethod === 'CASH' ? o.total : 0,
          needsTerminal: o.type === 'DELIVERY' && o.paymentMethod === 'CARD_ON_DELIVERY',
        })),
        // Частичный уникальный индекс «одна основная плитка на заказ»
        // гасит гонку двух экземпляров крона
        skipDuplicates: true,
      });
    }

    const cancelled = await this.prisma.deliveryTask.findMany({
      where: {
        venueId,
        status: { in: ['NEW', 'READY', 'ASSIGNED'] },
        order: { status: 'CANCELLED' },
      },
      select: { id: true, tenantId: true },
    });
    for (const t of cancelled) {
      await this.prisma.deliveryTask.update({
        where: { id: t.id },
        data: { status: 'CANCELLED' },
      });
      await this.event(t.tenantId, t.id, 'CANCELLED', 'SYSTEM');
    }
    return { created: fresh.length, cancelled: cancelled.length };
  }

  // ─── Доска ─────────────────────────────────────────────────────

  async board(device: DispatchDeviceValue, now = new Date()) {
    const since = new Date(now.getTime() - BOARD_HORIZON_MS);
    const [tasks, shifts, checkIns, handovers, settlements] = await Promise.all([
      this.prisma.deliveryTask.findMany({
        where: {
          venueId: device.venueId,
          OR: [
            { status: { in: ACTIVE }, createdAt: { gt: since } },
            { status: { in: DONE }, updatedAt: { gt: new Date(now.getTime() - DONE_VISIBLE_MS) } },
          ],
        },
        // По времени заказа, а не плитки: плитки одного прохода крона
        // создаются в одну миллисекунду, и порядок между ними случаен
        orderBy: [{ order: { createdAt: 'asc' } }, { id: 'asc' }],
        include: {
          courier: { select: { fullName: true } },
          order: {
            select: {
              number: true,
              type: true,
              createdAt: true,
              scheduledAt: true,
              paymentMethod: true,
              items: {
                select: {
                  name: true,
                  qty: true,
                  modifiers: true,
                  isUnavailable: true,
                  product: { select: { posterAccount: { select: { name: true, kind: true } } } },
                },
              },
              // Касса WDrink (DECISIONS §15): приняли ли напитки
              dispatches: {
                where: { posterAccount: { kind: 'WDRINK' }, status: { not: 'VOID' } },
                select: { posterStatus: true, posterAccount: { select: { name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.courierShift.findMany({
        where: { venueId: device.venueId, endedAt: null },
        orderBy: [{ scheduled: 'desc' }, { queuedAt: 'asc' }],
        include: { courier: { select: { fullName: true } } },
      }),
      // Кто отметился за последнюю минуту — всплывает на планшете, чтобы
      // раздача видела, если «отметился» человек, которого нет у стойки
      this.prisma.deliveryTaskEvent.findMany({
        where: {
          type: 'CHECK_IN',
          at: { gt: new Date(now.getTime() - 60_000) },
          shift: { venueId: device.venueId },
        },
        orderBy: { at: 'desc' },
        take: 5,
        include: { shift: { select: { courier: { select: { fullName: true } } } } },
      }),
      // Деньги, которые ждут кассира: видно и тем, кто не смотрит в телефон
      this.prisma.courierCashEntry.findMany({
        where: { tenantId: device.tenantId, type: 'HANDED_IN', status: 'PENDING' },
        include: { courier: { select: { fullName: true } } },
      }),
      this.prisma.courierSettlement.findMany({
        where: { tenantId: device.tenantId, status: 'PENDING' },
        include: { courier: { select: { fullName: true } } },
      }),
    ]);

    // Подсветка тревог на плитках — по тем же правилам, что и в Telegram
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: device.tenantId },
      select: { settings: true },
    });
    const cfg = courierSettings(tenant?.settings);
    const waitingShifts = shifts.filter((s) => s.state === 'WAITING');
    const alertCtx = {
      waitingCouriers: waitingShifts.length,
      firstWaitingSince:
        waitingShifts
          .map((s) => s.queuedAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    };

    const qr = createQrToken(device.venueId, now.getTime());
    return {
      now: now.toISOString(),
      device: { name: device.name },
      readyUndoSec: READY_UNDO_SEC,
      qr: {
        svg: await QRCode.toString(qr.token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
        refreshInMs: qr.refreshInMs,
      },
      cashAlerts: [
        ...handovers.map((h) => ({
          id: h.id,
          text: `${shortName(h.courier.fullName)} сдаёт ${tengeText(h.claimedAmount ?? -h.amount)}`,
        })),
        ...settlements.map((st) => ({
          id: st.id,
          text:
            st.courierPays > 0
              ? `Расчёт: ${shortName(st.courier.fullName)} сдаёт ${tengeText(st.courierPays)}`
              : `Расчёт: заплатить ${shortName(st.courier.fullName)} ${tengeText(st.venuePays)}`,
        })),
      ],
      checkIns: checkIns.map((e) => ({
        id: e.id,
        name: shortName(e.shift?.courier.fullName ?? ''),
        at: e.at.toISOString(),
      })),
      couriers: shifts.map((s) => ({
        shiftId: s.id,
        name: shortName(s.courier.fullName),
        state: s.state,
        queuedAt: s.queuedAt?.toISOString() ?? null,
        pauseUntil: s.pauseUntil?.toISOString() ?? null,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        number: t.order.number,
        createdAt: t.order.createdAt.toISOString(),
        scheduledAt: t.order.scheduledAt?.toISOString() ?? null,
        readyAt: t.readyAt?.toISOString() ?? null,
        pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
        doneAt: (t.deliveredAt ?? (DONE.includes(t.status) ? t.updatedAt : null))?.toISOString() ?? null,
        courier: t.courier ? shortName(t.courier.fullName) : null,
        cash: t.cashToCollect,
        needsTerminal: t.needsTerminal,
        extraReason: t.extraReason,
        alert: taskAlert(t, alertCtx, cfg, now),
        // Напитки готовит другая касса и приносит на раздачу: видно, приняла
        // ли она заказ, чтобы не нажать «Готов» без них
        drinks:
          t.kind === 'EXTRA_TRIP' || !t.order.dispatches?.length
            ? null
            : {
                name: t.order.dispatches[0].posterAccount.name,
                accepted: t.order.dispatches.every((d) => d.posterStatus === 'ACCEPTED'),
              },
        // У довоза свой «состав» — причина; весь заказ на плитке путал бы
        items: t.kind === 'EXTRA_TRIP' ? [] : t.order.items
          .filter((i) => !i.isUnavailable)
          .map((i) => ({
            name: i.name,
            qty: i.qty,
            source:
              i.product?.posterAccount?.kind === 'WDRINK' ? i.product.posterAccount.name : null,
            modifiers: ((i.modifiers as Modifier[] | null) ?? [])
              .map((m) => m?.name)
              .filter((n): n is string => !!n),
          })),
      })),
    };
  }

  // ─── Действия раздачи ──────────────────────────────────────────

  /** «Готов»: пакет собран. Повторное нажатие ничего не ломает */
  async markReady(device: DispatchDeviceValue, taskId: string) {
    const task = await this.ownTask(device, taskId);
    if (task.status === 'READY') return { status: task.status };
    if (task.status !== 'NEW') {
      throw new BadRequestException('Заказ уже не в колонке «Новый»');
    }
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: 'NEW' },
      data: { status: 'READY', readyAt: new Date() },
    });
    if (changed.count > 0) {
      await this.event(device.tenantId, taskId, 'READY', `DEVICE:${device.id}`);
      await this.assignment.assignVenue(device.venueId);
    }
    return { status: 'READY' as const };
  }

  /**
   * «Отменить» в первые секунды после «Готов» — на случай, если нажали
   * не ту плитку. Если заказ уже назначен, курьер получает «отбой» и
   * остаётся в очереди на своём месте.
   */
  async undoReady(device: DispatchDeviceValue, taskId: string) {
    const task = await this.ownTask(device, taskId);
    const fresh =
      task.readyAt && Date.now() - task.readyAt.getTime() <= (READY_UNDO_SEC + 5) * 1000;
    if (task.status === 'ASSIGNED' && fresh) {
      if (await this.assignment.unassign(taskId, 'READY_UNDONE', `DEVICE:${device.id}`)) {
        return { status: 'NEW' as const };
      }
    }
    if (task.status !== 'READY' || !fresh) {
      throw new BadRequestException('Отменить уже нельзя');
    }
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: 'READY' },
      data: { status: 'NEW', readyAt: null },
    });
    if (changed.count > 0) {
      await this.event(device.tenantId, taskId, 'READY_UNDONE', `DEVICE:${device.id}`);
    }
    return { status: 'NEW' as const };
  }

  /** Самовывоз выдан клиенту. Можно и из «Нового», если «Готов» забыли */
  async handOver(device: DispatchDeviceValue, taskId: string) {
    const task = await this.ownTask(device, taskId);
    if (task.kind !== 'PICKUP') throw new BadRequestException('Это не самовывоз');
    if (task.status === 'HANDED_OVER') return { status: task.status };
    if (task.status !== 'NEW' && task.status !== 'READY') {
      throw new BadRequestException('Заказ уже закрыт');
    }
    const now = new Date();
    await this.prisma.deliveryTask.update({
      where: { id: taskId },
      data: { status: 'HANDED_OVER', readyAt: task.readyAt ?? now, deliveredAt: now },
    });
    await this.event(device.tenantId, taskId, 'HANDED_OVER', `DEVICE:${device.id}`);
    return { status: 'HANDED_OVER' as const };
  }

  /**
   * Довоз (§9 ТЗ): забыли колу, перепутали позицию. Раздача создаёт его
   * на планшете по номеру заказа, собирает и жмёт «Готов» — дальше как
   * обычный заказ: курьер, «Забрал», адрес, оплата поездки.
   */
  async createExtraTrip(device: DispatchDeviceValue, number: number, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { tenantId: device.tenantId, venueId: device.venueId, number },
      select: { id: true, type: true, status: true, tenantId: true },
    });
    if (!order) throw new NotFoundException(`Заказа №${number} нет`);
    if (order.type !== 'DELIVERY') throw new BadRequestException(`№${number} — самовывоз, везти нечего`);
    if (order.status === 'CANCELLED') throw new BadRequestException(`№${number} отменён`);

    const task = await this.prisma.deliveryTask.create({
      data: {
        tenantId: order.tenantId,
        venueId: device.venueId,
        orderId: order.id,
        kind: 'EXTRA_TRIP',
        extraReason: reason.trim(),
        createdBy: `DEVICE:${device.id}`,
      },
    });
    await this.event(device.tenantId, task.id, 'EXTRA_TRIP_CREATED', `DEVICE:${device.id}`, { reason });
    // Руководству — для разбора, кто ошибся; кассе не нужно, раздача и так знает
    await this.telegram.notify(
      device.tenantId,
      `↩️ <b>Довоз к №${number}</b>: ${esc(reason.trim())}`,
    );
    return { id: task.id };
  }

  // ─── Устройства (админка) ──────────────────────────────────────

  async listDevices(tenantId: string) {
    const rows = await this.prisma.dispatchDevice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { venue: { select: { name: true } } },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      venue: d.venue.name,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /**
   * Новый планшет. Токен возвращается один раз: в базе только его хеш,
   * и показать его повторно нельзя. Потерян — выключить и создать новый.
   */
  async createDevice(tenantId: string, name: string, venueId?: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { tenantId, isActive: true, ...(venueId ? { id: venueId } : {}) },
      orderBy: { name: 'asc' },
    });
    if (!venue) throw new NotFoundException('Нет активной точки');
    const token = randomBytes(32).toString('base64url');
    const device = await this.prisma.dispatchDevice.create({
      data: { tenantId, venueId: venue.id, name: name.trim(), tokenHash: hashDeviceToken(token) },
    });
    return { id: device.id, name: device.name, venue: venue.name, token };
  }

  async setDeviceActive(tenantId: string, id: string, isActive: boolean) {
    const changed = await this.prisma.dispatchDevice.updateMany({
      where: { id, tenantId },
      data: { isActive },
    });
    if (changed.count === 0) throw new NotFoundException('Планшет не найден');
    return { id, isActive };
  }

  // ─── Вспомогательное ───────────────────────────────────────────

  private async ownTask(device: DispatchDeviceValue, taskId: string) {
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: taskId, venueId: device.venueId },
    });
    if (!task) throw new NotFoundException('Заказ не найден');
    return task;
  }

  private event(tenantId: string, taskId: string, type: string, actor: string, meta?: Prisma.InputJsonValue) {
    return this.prisma.deliveryTaskEvent.create({
      data: { tenantId, taskId, type, actor, ...(meta !== undefined ? { meta } : {}) },
    });
  }
}

const tengeText = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

export { shortName } from './names';
