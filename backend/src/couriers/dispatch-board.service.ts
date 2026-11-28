import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { esc, TelegramService } from '../telegram/telegram.service';
import { Cron } from '@nestjs/schedule';
import { DeliveryTaskStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentService } from './assignment.service';
import { taskAlert } from './courier-alerts.service';
import { CourierCashService } from './courier-cash.service';
import { CourierPhotoService } from './courier-photo.service';
import { courierSettings } from './courier-settings';
import { DispatchDeviceValue, hashDeviceToken } from './dispatch-device.guard';
import { createQrToken } from './dispatch-qr';
import { shortName } from './names';
import { externalOf, externalPaymentLine, orderOf, PREORDER_LEAD_MS, releaseAt, startOfDay } from './task-order';
import { formatAddress } from './courier-app.service';
import { completeDelivery } from './delivery-completion';
import { paymentLine } from './assignment.service';
import { NotificationsService } from '../notifications/notifications.service';

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
    private readonly cash?: CourierCashService,
    private readonly photos?: CourierPhotoService,
    private readonly notifications?: NotificationsService,
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
    const dayStart = startOfDay(now);
    const fresh = (
      await this.prisma.order.findMany({
        where: {
          venueId,
          // Предзаказ, оформленный вчера и раньше, — по времени доставки
          OR: [
            { createdAt: { gt: since } },
            { scheduledAt: { gt: since, lte: new Date(now.getTime() + PREORDER_LEAD_MS) } },
          ],
          // Принят на планшете Poster; дальше статусы ставит этот модуль
          status: { in: ['ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
          deliveryTasks: { none: { kind: { in: ['DELIVERY', 'PICKUP'] } } },
        },
        select: {
          id: true,
          tenantId: true,
          type: true,
          paymentMethod: true,
          total: true,
          createdAt: true,
          scheduledAt: true,
        },
      })
    ).filter((o) => releaseAt(o.createdAt, o.scheduledAt, dayStart) <= now);
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
              address: true,
              comment: true,
              changeFrom: true,
              customer: { select: { phone: true, name: true } },
              items: {
                select: {
                  name: true,
                  qty: true,
                  modifiers: true,
                  isUnavailable: true,
                  product: { select: { posterAccountId: true } },
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
        include: {
          courier: { select: { id: true, fullName: true, selfieFileId: true } },
          tasks: { where: { status: { in: ['ASSIGNED', 'PICKED_UP'] } }, select: { status: true } },
        },
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
    const departments = await this.departments(device.tenantId);
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
        courierId: s.courier.id,
        name: shortName(s.courier.fullName),
        photo: !!s.courier.selfieFileId,
        // Везёт заказ — «Уехал» и «Закончил смену» ему не нужны
        carrying: s.tasks.some((t) => t.status === 'PICKED_UP'),
        state: s.state,
        queuedAt: s.queuedAt?.toISOString() ?? null,
        pauseUntil: s.pauseUntil?.toISOString() ?? null,
      })),
      tasks: tasks.map((raw) => {
        // Заказ из Poster (старое приложение) — данные из снимка
        const o = orderOf(raw);
        const ext = externalOf(raw.external);
        const t = { ...raw, order: { createdAt: o.createdAt, scheduledAt: o.scheduledAt } };
        return {
        id: t.id,
        kind: t.kind,
        status: t.status,
        number: o.number,
        external: o.external,
        createdAt: o.createdAt.toISOString(),
        scheduledAt: o.scheduledAt?.toISOString() ?? null,
        readyAt: t.readyAt?.toISOString() ?? null,
        pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
        doneAt: (t.deliveredAt ?? (DONE.includes(t.status) ? t.updatedAt : null))?.toISOString() ?? null,
        courier: t.courier ? shortName(t.courier.fullName) : null,
        batchSeq: t.batchSeq,
        // Позиции других отделов (Sunday): раздача ждёт, пока их принесут
        otherDepartments:
          t.kind === 'EXTRA_TRIP' ? [] : otherDepartments(o.items, departments),
        cash: t.cashToCollect,
        needsTerminal: t.needsTerminal,
        extraReason: t.extraReason,
        alert: taskAlert(t, alertCtx, cfg, now),
        // Напитки готовит другая касса и приносит на раздачу: видно, приняла
        // ли она заказ, чтобы не нажать «Готов» без них
        drinks:
          raw.kind === 'EXTRA_TRIP' || !raw.order?.dispatches?.length
            ? null
            : {
                name: raw.order.dispatches[0].posterAccount.name,
                accepted: raw.order.dispatches.every((d) => d.posterStatus === 'ACCEPTED'),
              },
        // Для большой карточки по долгому нажатию: раздача уточняет детали
        details: {
          address: o.address ? formatAddress(o.address as Parameters<typeof formatAddress>[0]) : null,
          addressComment: (o.address as { comment?: string } | null)?.comment || null,
          phone: o.phone,
          customerName: o.customerName,
          comment: o.comment || null,
          payment: ext
            ? externalPaymentLine(ext)
            : paymentLine({ ...raw, changeFrom: o.changeFrom }),
          // Отменить на планшете можно только заказ старого приложения:
          // наш отменяется через кассу — это касается клиента и оплаты
          cancellable: raw.source === 'POSTER' && ['NEW', 'READY', 'ASSIGNED'].includes(raw.status),
          // Ручные статусы — когда у планшета пропадала связь
          canMarkPickedUp: raw.kind !== 'PICKUP' && ['NEW', 'READY', 'ASSIGNED'].includes(raw.status),
          canMarkDelivered: raw.kind !== 'PICKUP' && ACTIVE.includes(raw.status),
          courierId: raw.courierId,
        },
        // У довоза свой «состав» — причина; весь заказ на плитке путал бы
        items: t.kind === 'EXTRA_TRIP' ? [] : o.items
          .filter((i) => !i.isUnavailable)
          .map((i) => ({
            name: i.name,
            qty: i.qty,
            department: departmentOf(i, departments),
            modifiers: ((i.modifiers as Modifier[] | null) ?? [])
              .map((m) => m?.name)
              .filter((n): n is string => !!n),
          })),
        };
      }),
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
      if (task.kind === 'PICKUP') await this.pickupReady(task.orderId, true);
      await this.assignment.assignVenue(device.venueId);
    }
    return { status: 'READY' as const };
  }

  /**
   * Самовывоз (Дом, 28.11.2026): «Готов» на планшете — клиенту пуш «Готов
   * к выдаче», заказ в приложении в статусе «Готов». «Не готово» молча
   * возвращает «Готовится»: второй пуш «ещё не готов» только смутил бы.
   * Доставкой статусы клиенту пока не шлём — сначала обкатаем на самовывозе.
   */
  private async pickupReady(orderId: string | null, ready: boolean) {
    if (!orderId) return;
    const changed = await this.prisma.order.updateMany({
      where: ready
        ? { id: orderId, type: 'PICKUP', status: { in: ['ACCEPTED', 'COOKING'] } }
        : { id: orderId, type: 'PICKUP', status: 'READY' },
      data: { status: ready ? 'READY' : 'COOKING' },
    });
    if (ready && changed.count > 0) {
      await this.notifications?.sendOrderStatus(orderId, 'READY').catch((e) =>
        this.logger.warn(`Пуш «Готов к выдаче» не ушёл: ${e instanceof Error ? e.message : e}`),
      );
    }
  }

  /**
   * «Не готово»: «Готов» нажали не на ту плитку. Раньше — только в первые
   * секунды; с 28.11.2026 — пока курьер не забрал (Дом: курьер приходит,
   * а пакет не собран, вернуть было нельзя). Назначенный курьер получает
   * «отбой» и остаётся в очереди на своём месте.
   */
  async undoReady(device: DispatchDeviceValue, taskId: string) {
    const task = await this.ownTask(device, taskId);
    if (task.status === 'NEW') return { status: 'NEW' as const };
    if (task.status === 'ASSIGNED') {
      if (await this.assignment.unassign(taskId, 'READY_UNDONE', `DEVICE:${device.id}`)) {
        return { status: 'NEW' as const };
      }
      throw new BadRequestException('Не получилось — обновите экран и попробуйте ещё раз');
    }
    if (task.status !== 'READY') {
      throw new BadRequestException('Курьер уже забрал заказ — вернуть в «Новый» нельзя');
    }
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: 'READY' },
      data: { status: 'NEW', readyAt: null },
    });
    if (changed.count > 0) {
      await this.event(device.tenantId, taskId, 'READY_UNDONE', `DEVICE:${device.id}`);
      if (task.kind === 'PICKUP') await this.pickupReady(task.orderId, false);
    }
    return { status: 'NEW' as const };
  }

  /**
   * «Отменить заказ» в большой карточке. Только для заказов старого
   * приложения: кассир отменил чек в Poster, а плитка осталась. Если заказ
   * уже назначен, курьер получает «отменён» и остаётся в очереди на месте.
   * Уехавший с заказом курьер — не отмена, а «Не удалось доставить».
   */
  async cancelTask(device: DispatchDeviceValue, taskId: string) {
    const task = await this.ownTask(device, taskId);
    if (task.status === 'CANCELLED') return { status: task.status };
    if (task.source !== 'POSTER') {
      throw new BadRequestException(
        'Наш заказ отменяется через кассу: в Telegram «Действия» → «Отменить». Плитка уйдёт сама',
      );
    }
    if (task.status === 'PICKED_UP') {
      throw new BadRequestException('Курьер уже везёт заказ — отменить на планшете нельзя');
    }
    if (!['NEW', 'READY', 'ASSIGNED'].includes(task.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }
    const actor = `DEVICE:${device.id}`;
    if (task.status === 'ASSIGNED') {
      if (await this.assignment.unassign(taskId, 'CANCELLED', actor)) return { status: 'CANCELLED' as const };
      throw new BadRequestException('Заказ только что изменился, попробуйте ещё раз');
    }
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: { in: ['NEW', 'READY'] } },
      data: { status: 'CANCELLED' },
    });
    if (changed.count === 0) throw new BadRequestException('Заказ только что изменился, попробуйте ещё раз');
    await this.event(device.tenantId, taskId, 'CANCELLED', actor);
    return { status: 'CANCELLED' as const };
  }

  // ─── Ручные статусы (у планшета пропал интернет) ───────────────

  /**
   * «Забрал курьер…»: пока планшет был без связи, курьер взял пакет сам.
   * Раздача выбирает его из тех, кто на смене. Заказ — у него «в пути»,
   * как после ползунка; курьеру приходит сообщение, адрес — в приложении.
   * Если заказ был назначен другому — тому «отбой», он остаётся в очереди.
   */
  async markPickedUp(device: DispatchDeviceValue, taskId: string, shiftId: string) {
    const task = await this.ownTask(device, taskId);
    if (task.kind === 'PICKUP') throw new BadRequestException('Это самовывоз: «Выдан клиенту»');
    const shift = await this.venueShift(device, shiftId);
    if (task.status === 'PICKED_UP' && task.courierId === shift.courierId) return { status: task.status };
    if (!['NEW', 'READY', 'ASSIGNED'].includes(task.status)) {
      throw new BadRequestException(
        task.status === 'PICKED_UP' ? 'Заказ уже везёт другой курьер' : 'Заказ уже закрыт',
      );
    }
    const actor = `DEVICE:${device.id}`;
    const before = { courierId: task.courierId, shiftId: task.shiftId, status: task.status };
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.deliveryTask.updateMany({
        where: { id: taskId, status: before.status, courierId: before.courierId },
        data: {
          status: 'PICKED_UP',
          courierId: shift.courierId,
          shiftId: shift.id,
          readyAt: task.readyAt ?? now,
          assignedAt: task.assignedAt ?? now,
          pickedUpAt: now,
          pickupMethod: 'DISPATCH',
        },
      });
      if (changed.count === 0) throw new BadRequestException('Заказ только что изменился, попробуйте ещё раз');
      await this.releaseBatch(tx, task, shift.courierId);
      await this.freePrevious(tx, before, shift.id);
      await tx.courierShift.update({ where: { id: shift.id }, data: { state: 'ON_DELIVERY', pauseUntil: null } });
      await tx.deliveryTaskEvent.create({
        data: {
          tenantId: device.tenantId,
          taskId,
          shiftId: shift.id,
          courierId: shift.courierId,
          type: 'PICKED_UP',
          actor,
          meta: { method: 'DISPATCH' },
        },
      });
    });
    const number = await this.numberOf(taskId);
    await this.tellPrevious(device.tenantId, before, shift.courierId, number);
    await this.assignment.sendToCourier(
      device.tenantId,
      shift.courier.telegramUserId,
      `📦 Раздача отметила: вы везёте №${number}. Адрес и «Доставлен» — в приложении.`,
    );
    // Освободился назначенный курьер — ему может достаться следующий заказ
    if (before.status === 'ASSIGNED') await this.assignment.assignVenue(device.venueId);
    return { status: 'PICKED_UP' as const };
  }

  /**
   * «Доставлен»: курьер успел забрать и отвезти, пока планшет был без
   * связи. Доставка засчитывается курьеру в оплату, наличные — на нём,
   * как после его собственного «Доставлен». У заказа, который ещё никто
   * не вёз, раздача выбирает курьера (`shiftId`).
   */
  async markDelivered(device: DispatchDeviceValue, taskId: string, shiftId?: string) {
    const task = await this.ownTask(device, taskId);
    if (task.kind === 'PICKUP') throw new BadRequestException('Это самовывоз: «Выдан клиенту»');
    if (task.status === 'DELIVERED') return { status: task.status };
    if (!['NEW', 'READY', 'ASSIGNED', 'PICKED_UP'].includes(task.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }
    // Везёт — закрываем за того, кто везёт; иначе — за выбранного
    const carrying = task.status === 'PICKED_UP';
    const shift = carrying
      ? await this.prisma.courierShift.findFirst({ where: { id: task.shiftId ?? '' }, include: { courier: true } })
      : shiftId
        ? await this.venueShift(device, shiftId)
        : null;
    if (!shift || (carrying && shift.courierId !== task.courierId)) {
      if (carrying) throw new BadRequestException('Не найдена смена курьера, который везёт заказ');
      throw new BadRequestException('Выберите курьера, который отвёз заказ');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: device.tenantId }, select: { settings: true } });
    const cfg = courierSettings(tenant?.settings);
    const actor = `DEVICE:${device.id}`;
    const before = { courierId: task.courierId, shiftId: task.shiftId, status: task.status };
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const ok = await completeDelivery(tx, {
        tenantId: device.tenantId,
        task,
        courierId: shift.courierId,
        shiftId: shift.id,
        from: [before.status as 'NEW' | 'READY' | 'ASSIGNED' | 'PICKED_UP'],
        currentCourierId: before.courierId,
        deliveryPay: cfg.deliveryPay,
        now,
        handoffMethod: 'DISPATCH',
        data: {
          readyAt: task.readyAt ?? now,
          assignedAt: task.assignedAt ?? now,
          pickedUpAt: task.pickedUpAt ?? now,
          ...(carrying ? {} : { pickupMethod: 'DISPATCH' }),
        },
      });
      if (!ok) throw new BadRequestException('Заказ только что изменился, попробуйте ещё раз');
      if (!carrying) {
        await this.releaseBatch(tx, task, shift.courierId);
        await this.freePrevious(tx, before, shift.id);
      }
      // Вёз и больше ничего не везёт — едет обратно, в очередь встанет
      // сканом QR. Не вёз (стоял в очереди) — место в очереди не трогаем.
      if (carrying) {
        const more = await tx.deliveryTask.count({ where: { shiftId: shift.id, status: 'PICKED_UP' } });
        await tx.courierShift.update({
          where: { id: shift.id },
          data: more > 0 ? { lastDeliveredAt: now } : { state: 'RETURNING', lastDeliveredAt: now },
        });
      } else {
        await tx.courierShift.update({ where: { id: shift.id }, data: { lastDeliveredAt: now } });
      }
      await tx.deliveryTaskEvent.create({
        data: {
          tenantId: device.tenantId,
          taskId,
          shiftId: shift.id,
          courierId: shift.courierId,
          type: 'DELIVERED',
          actor,
          meta: { method: 'DISPATCH' },
        },
      });
    });
    const number = await this.numberOf(taskId);
    await this.tellPrevious(device.tenantId, before, shift.courierId, number);
    await this.assignment.sendToCourier(
      device.tenantId,
      shift.courier.telegramUserId,
      `✅ Раздача отметила №${number} доставленным, доставка засчитана.` +
        (task.cashToCollect > 0 ? ` Наличные ${tengeText(task.cashToCollect)} — на вас, сдайте кассиру.` : ''),
    );
    if (before.status === 'ASSIGNED' && before.courierId !== shift.courierId) {
      await this.assignment.assignVenue(device.venueId);
    }
    return { status: 'DELIVERED' as const };
  }

  /** Связку, которую повезёт другой курьер, разбиваем: каждый везёт своё */
  private async releaseBatch(
    tx: Prisma.TransactionClient,
    task: { id: string; batchId: string | null; courierId: string | null },
    courierId: string,
  ) {
    if (!task.batchId || task.courierId === courierId) return;
    await tx.deliveryTask.updateMany({
      where: { batchId: task.batchId },
      data: { batchId: null, batchSeq: null },
    });
  }

  /** Назначенный раньше курьер без других заказов — снова ждёт в очереди */
  private async freePrevious(
    tx: Prisma.TransactionClient,
    before: { shiftId: string | null; status: string },
    newShiftId: string,
  ) {
    if (before.status !== 'ASSIGNED' || !before.shiftId || before.shiftId === newShiftId) return;
    const rest = await tx.deliveryTask.count({
      where: { shiftId: before.shiftId, status: { in: ['ASSIGNED', 'PICKED_UP'] } },
    });
    if (rest === 0) {
      await tx.courierShift.updateMany({ where: { id: before.shiftId, state: 'ASSIGNED' }, data: { state: 'WAITING' } });
    }
  }

  private async tellPrevious(
    tenantId: string,
    before: { courierId: string | null; status: string },
    newCourierId: string,
    number: string,
  ) {
    if (before.status !== 'ASSIGNED' || !before.courierId || before.courierId === newCourierId) return;
    const prev = await this.prisma.courier.findUnique({ where: { id: before.courierId }, select: { telegramUserId: true } });
    if (!prev) return;
    await this.assignment.sendToCourier(
      tenantId,
      prev.telegramUserId,
      `↩️ №${number} забрал другой курьер, вам забирать не нужно. Вы остаётесь в очереди.`,
    );
  }

  private async numberOf(taskId: string) {
    const t = await this.prisma.deliveryTask.findUnique({
      where: { id: taskId },
      include: { order: { select: { number: true } } },
    });
    return t ? orderOf(t).number : '—';
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

  // ─── Курьер у раздачи ──────────────────────────────────────────

  /** Курьер на смене у этой раздачи: смена открыта и точка та же */
  private async venueShift(device: DispatchDeviceValue, shiftId: string) {
    const shift = await this.prisma.courierShift.findFirst({
      where: { id: shiftId, venueId: device.venueId, endedAt: null },
      include: { courier: true },
    });
    if (!shift) throw new NotFoundException('Курьер уже не на смене');
    return shift;
  }

  private async assertNotCarrying(shiftId: string) {
    const carrying = await this.prisma.deliveryTask.findFirst({
      where: { shiftId, status: 'PICKED_UP' },
      include: { order: { select: { number: true } } },
    });
    if (carrying) {
      throw new BadRequestException(
        `Курьер везёт №${orderOf(carrying).number}: он сам вернётся в очередь сканом QR`,
      );
    }
  }

  /**
   * «Уехал» (временно, пока заказы идут и из старого приложения): курьер
   * вне очереди без нарушения, назначенный ему заказ сразу уходит
   * следующему. Вернётся — отсканирует QR и встанет в конец.
   */
  async courierAway(device: DispatchDeviceValue, shiftId: string) {
    const shift = await this.venueShift(device, shiftId);
    await this.assertNotCarrying(shift.id);
    const released = await this.assignment.releaseShift(shift.id, 'COURIER_LEFT', `DEVICE:${device.id}`);
    return { released: released ?? [] };
  }

  /**
   * «Закончил смену» за курьера, который ушёл и забыл закрыть её сам.
   * Расчёт смены, как обычно, приходит карточкой в чат кассы.
   */
  async courierEndShift(device: DispatchDeviceValue, shiftId: string) {
    const shift = await this.venueShift(device, shiftId);
    await this.assertNotCarrying(shift.id);
    const actor = `DEVICE:${device.id}`;
    await this.assignment.releaseShift(shift.id, 'COURIER_LEFT', actor);
    const closed = await this.prisma.courierShift.updateMany({
      where: { id: shift.id, endedAt: null },
      data: { endedAt: new Date(), endedBy: 'DISPATCH', state: 'AWAY', pauseUntil: null },
    });
    if (closed.count === 0) return { ended: false };
    await this.prisma.courier.update({
      where: { id: shift.courierId },
      data: { completedShifts: { increment: 1 } },
    });
    await this.prisma.deliveryTaskEvent.create({
      data: {
        tenantId: shift.tenantId,
        shiftId: shift.id,
        courierId: shift.courierId,
        type: 'SHIFT_END',
        actor,
      },
    });
    await this.cash?.createSettlement(shift.tenantId, shift.courier, shift.id, 'DISPATCH');
    await this.assignment.sendToCourier(
      shift.tenantId,
      shift.courier.telegramUserId,
      '🏁 Раздача закрыла вашу смену. Расчёт по смене — у кассира.',
    );
    return { ended: true };
  }

  /** Селфи курьера на смене у этой раздачи — для очереди с лицами */
  async courierPhoto(device: DispatchDeviceValue, courierId: string) {
    const shift = await this.prisma.courierShift.findFirst({
      where: { courierId, venueId: device.venueId, endedAt: null },
      select: { courier: { select: { selfieFileId: true } } },
    });
    const fileId = shift?.courier.selfieFileId;
    const file = fileId && this.photos ? await this.photos.get(device.tenantId, fileId) : null;
    if (!file) throw new NotFoundException('Нет фото');
    return file;
  }

  /**
   * Отделы Poster тенанта. Основной — первый по порядку (у него
   * наименьший sortOrder, при равенстве — созданный раньше: cuid растёт
   * со временем). Остальные помечаются на плитке.
   */
  private async departments(tenantId: string): Promise<Departments> {
    const rows = await this.prisma.posterAccount.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    return { mainId: rows[0]?.id ?? null, names: new Map(rows.map((r) => [r.id, r.name])) };
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

type Departments = { mainId: string | null; names: Map<string, string> };
type DeptItem = { qty: number; isUnavailable: boolean; product: { posterAccountId: string } | null };

/** Отдел позиции, если он не основной: «Sunday» */
export function departmentOf(item: DeptItem, d: Departments): string | null {
  const id = item.product?.posterAccountId;
  if (!id || d.names.size < 2 || id === d.mainId) return null;
  return d.names.get(id) ?? null;
}

/** Сколько позиций каждого неосновного отдела в заказе: [{name: «Sunday», count: 2}] */
export function otherDepartments(items: DeptItem[], d: Departments) {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (i.isUnavailable) continue;
    const name = departmentOf(i, d);
    if (name) counts.set(name, (counts.get(name) ?? 0) + i.qty);
  }
  const live = items.filter((i) => !i.isUnavailable).length;
  const onlyOther = live > 0 && items.every((i) => i.isUnavailable || departmentOf(i, d));
  return [...counts].map(([name, count]) => ({ name, count, only: onlyOther }));
}

const tengeText = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

export { shortName } from './names';
