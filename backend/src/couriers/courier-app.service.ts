import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { AssignmentService, itemsLine, paymentLine } from './assignment.service';
import { CourierActorValue } from './courier-auth.guard';
import { CourierCashService, PaidBy } from './courier-cash.service';
import { CourierPhotoService } from './courier-photo.service';
import { CourierRegistrationService } from './courier-registration.service';
import { courierSettings } from './courier-settings';
import { verifyQrToken } from './dispatch-qr';
import { completeDelivery } from './delivery-completion';
import { shortName } from './names';
import { externalOf, externalPaymentLine, orderOf, telNumber } from './task-order';

/**
 * Что курьер делает в Mini App (docs/COURIER_SYSTEM_SPEC.md §5–7):
 * «Я на месте» сканом QR → получает заказ → отмечает состав галочками и
 * «Поехали» сканом QR (только тогда видит адрес) → «Доставлен» или
 * «Не удалось».
 *
 * Этапы 1–3: клиент ничего не видит, Order.status не трогаем.
 */

type Address = {
  street?: string;
  house?: string;
  flat?: string;
  entrance?: string;
  floor?: string;
  comment?: string;
  lat?: number;
  lng?: number;
};

const ACTIVE_TASK = ['ASSIGNED', 'PICKED_UP'] as const;

@Injectable()
export class CourierAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly assignment: AssignmentService,
    private readonly registration: CourierRegistrationService,
    private readonly cash: CourierCashService,
    private readonly geo: GeoService,
    private readonly photos: CourierPhotoService,
  ) {}

  // ─── Экран курьера ─────────────────────────────────────────────

  async me(actor: CourierActorValue) {
    const { courier } = actor;
    const shift = await this.openShift(courier.id);
    const cfg = courierSettings(actor.tenantSettings);

    let queuePosition: number | null = null;
    if (shift?.state === 'WAITING') {
      // Тот же порядок, что у раздачи заказов: график, потом время скана
      const queue = await this.prisma.courierShift.findMany({
        where: { venueId: shift.venueId, endedAt: null, state: 'WAITING' },
        orderBy: [{ scheduled: 'desc' }, { queuedAt: 'asc' }],
        select: { id: true },
      });
      queuePosition = queue.findIndex((q) => q.id === shift.id) + 1 || null;
    }

    const tasks = await this.prisma.deliveryTask.findMany({
      where: { courierId: courier.id, status: { in: [...ACTIVE_TASK] } },
      orderBy: [{ batchSeq: 'asc' }, { assignedAt: 'asc' }],
      include: {
        order: {
          select: {
            number: true,
            comment: true,
            changeFrom: true,
            address: true,
            customer: { select: { phone: true, name: true } },
            items: {
              select: {
                id: true,
                name: true,
                qty: true,
                modifiers: true,
                isGift: true,
                isUnavailable: true,
              },
              orderBy: { id: 'asc' },
            },
          },
        },
        venue: { select: { address: true } },
      },
    });

    // Очередь у раздачи целиком: кто ждёт, кто в пути, кто на паузе.
    // Видно, что очередь честная, — главный вопрос курьеров к раздаче
    const venueShifts =
      shift && courier.status === 'ACTIVE'
        ? await this.prisma.courierShift.findMany({
            where: { venueId: shift.venueId, endedAt: null, state: { not: 'AWAY' } },
            select: {
              state: true,
              scheduled: true,
              queuedAt: true,
              pauseUntil: true,
              courier: { select: { id: true, fullName: true, selfieFileId: true } },
              tasks: {
                where: { status: 'PICKED_UP' },
                select: { pickedUpAt: true },
                orderBy: { pickedUpAt: 'asc' },
                take: 1,
              },
            },
          })
        : [];

    const since = startOfDay();
    const today = await this.prisma.courierPayoutLine.aggregate({
      where: { courierId: courier.id, createdAt: { gte: since } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return {
      courier: { name: courier.fullName, status: courier.status },
      cash: await this.cash.summary(courier.id),
      shift: shift
        ? {
            state: shift.state,
            startedAt: shift.startedAt.toISOString(),
            queuePosition,
            pauseUntil: shift.pauseUntil?.toISOString() ?? null,
            pausesLeft: Math.max(cfg.pauseMaxPerShift - shift.pausesUsed, 0),
          }
        : null,
      pauseMin: cfg.pauseMin,
      pickupTimeoutMin: cfg.pickupTimeoutMin,
      queue: buildQueue(venueShifts, courier.id),
      tasks: await Promise.all(tasks.map(async (t) => {
        // Адрес и телефон — только после «Забрал»: до этого курьер видит
        // номер и состав, чтобы найти пакет. Во второй заказ связки —
        // только после первого: сначала везут более старый
        const first = nextInBatch(t, tasks);
        const picked = t.status === 'PICKED_UP' && !first;
        const o = orderOf(t);
        const ext = externalOf(t.external);
        const addr = picked ? await this.withCoords(actor.tenantSlug, o.address) : null;
        return {
          id: t.id,
          kind: t.kind,
          status: t.status,
          number: o.number,
          /// Заказ старого приложения или сайта, подтянутый из Poster
          external: o.external,
          items:
            t.kind === 'EXTRA_TRIP'
              ? `Довоз: ${t.extraReason ?? 'без причины'}`
              : itemsLine(o.items),
          // Галочки комплектации: по ним курьер сверяет пакет перед «Поехали»
          checklist: t.kind === 'EXTRA_TRIP' ? [] : checklist(o.items),
          payment: ext ? externalPaymentLine(ext) : paymentLine({ ...t, changeFrom: o.changeFrom }),
          cash: t.cashToCollect,
          needsTerminal: t.needsTerminal,
          assignedAt: t.assignedAt?.toISOString() ?? null,
          pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
          extraReason: t.extraReason,
          batchId: t.batchId,
          batchSeq: t.batchSeq,
          afterNumber: first ? orderOf(first).number : null,
          ...(picked
            ? {
                address: addr ? formatAddress(addr) : null,
                addressComment: addr?.comment || null,
                mapUrl: addr ? mapUrl(addr, cityOf(t.venue.address)) : null,
                phone: o.phone ? telNumber(o.phone) : null,
                customerName: o.customerName,
                comment: o.comment || null,
              }
            : {}),
        };
      })),
      today: { deliveries: today._count._all, earned: today._sum.amount ?? 0 },
    };
  }

  // ─── «Я на месте» ──────────────────────────────────────────────

  async checkIn(actor: CourierActorValue, qr: string) {
    const venueId = await this.venueFromQr(actor.tenantId, qr);
    const { courier } = actor;

    if (courier.status === 'PENDING') {
      // Первый приезд: кассир сверяет удостоверение и подтверждает
      await this.registration.sendApprovalCard(actor.tenantId, courier, { atCounter: true });
      return { pending: true, ...(await this.me(actor)) };
    }

    const busy = await this.prisma.deliveryTask.findFirst({
      where: { courierId: courier.id, status: 'PICKED_UP' },
      include: { order: { select: { number: true } } },
    });
    if (busy) {
      throw new BadRequestException(`Сначала завершите доставку №${orderOf(busy).number}`);
    }

    const now = new Date();
    let shift = await this.openShift(courier.id);
    if (shift && shift.venueId !== venueId) {
      // Перешёл в другую точку: прежняя смена закрывается
      await this.closeShift(actor, shift.id, 'AUTO');
      shift = null;
    }

    if (!shift) {
      try {
        shift = await this.prisma.courierShift.create({
          data: {
            tenantId: actor.tenantId,
            venueId,
            courierId: courier.id,
            state: 'WAITING',
            queuedAt: now,
          },
        });
      } catch (e) {
        // Двойной скан: смену уже открыл параллельный запрос
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        shift = (await this.openShift(courier.id))!;
      }
    } else if (shift.state === 'ON_PAUSE') {
      // С паузы — на своё прежнее место в очереди
      shift = await this.prisma.courierShift.update({
        where: { id: shift.id },
        data: { state: 'WAITING', pauseUntil: null },
      });
    } else if (shift.state !== 'WAITING' && shift.state !== 'ASSIGNED') {
      // Вернулся после доставки, паузы или отлучки — в конец очереди
      shift = await this.prisma.courierShift.update({
        where: { id: shift.id },
        data: { state: 'WAITING', queuedAt: now, pauseUntil: null },
      });
    }

    await this.prisma.deliveryTaskEvent.create({
      data: {
        tenantId: actor.tenantId,
        shiftId: shift.id,
        courierId: courier.id,
        type: 'CHECK_IN',
        actor: `COURIER:${courier.id}`,
      },
    });
    await this.cash.onArrival(actor.tenantId, actor.tenantSettings, courier);
    await this.assignment.assignVenue(venueId);
    return this.me(actor);
  }

  // ─── Пауза ─────────────────────────────────────────────────────

  /**
   * «Пауза 15 мин» — честный способ отойти (туалет, поесть). Заказы не
   * назначаются, место в очереди сохраняется, по окончании курьер
   * возвращается сам. Не больше `pauseMaxPerShift` раз за смену.
   */
  async pause(actor: CourierActorValue) {
    const cfg = courierSettings(actor.tenantSettings);
    const shift = await this.openShift(actor.courier.id);
    if (!shift || shift.state !== 'WAITING') {
      throw new BadRequestException('Пауза доступна, когда вы ждёте заказ в очереди');
    }
    if (shift.pausesUsed >= cfg.pauseMaxPerShift) {
      throw new BadRequestException('Паузы на эту смену закончились');
    }
    const changed = await this.prisma.courierShift.updateMany({
      where: { id: shift.id, state: 'WAITING' },
      data: {
        state: 'ON_PAUSE',
        pauseUntil: new Date(Date.now() + cfg.pauseMin * 60_000),
        pausesUsed: { increment: 1 },
      },
    });
    // Пока нажимал, мог прийти заказ — тогда пауза не ставится
    if (changed.count === 0) throw new BadRequestException('Вам только что назначили заказ');
    await this.prisma.deliveryTaskEvent.create({
      data: {
        tenantId: actor.tenantId,
        shiftId: shift.id,
        courierId: actor.courier.id,
        type: 'PAUSE_START',
        actor: `COURIER:${actor.courier.id}`,
      },
    });
    return this.me(actor);
  }

  async resume(actor: CourierActorValue) {
    const shift = await this.openShift(actor.courier.id);
    if (shift?.state === 'ON_PAUSE') {
      await this.assignment.endPause(shift.id, `COURIER:${actor.courier.id}`);
    }
    return this.me(actor);
  }

  // ─── «Сдаю наличку» ────────────────────────────────────────────

  async handIn(actor: CourierActorValue) {
    await this.cash.requestHandover(actor.tenantId, actor.courier, 'COURIER');
    return this.me(actor);
  }

  /** «Клиент оплатил иначе»: карточка кассиру, он подтверждает */
  async paidOtherwise(actor: CourierActorValue, taskId: string, paidBy: PaidBy) {
    await this.cash.requestPaidOtherwise(actor.tenantId, actor.courier, taskId, paidBy);
    return this.me(actor);
  }

  // ─── «Забрал» ──────────────────────────────────────────────────

  /**
   * «Поехали»: QR у раздачи плюс галочки по составу. Без скана («уже уехал,
   * забыл») галочки не спрашиваем — пакет уже не перед глазами, такая
   * выдача и так идёт с пометкой.
   */
  async pickedUp(
    actor: CourierActorValue,
    taskId: string,
    qr: string | null,
    confirmedItemIds: string[] = [],
  ) {
    const task = await this.ownTask(actor, taskId);
    if (task.status === 'PICKED_UP') return this.me(actor);
    if (task.status !== 'ASSIGNED') throw new BadRequestException('Этот заказ уже не ваш');

    // Связку забирают одним «Поехали»: оба пакета, одни галочки, один скан
    const group = task.batchId
      ? await this.prisma.deliveryTask.findMany({
          where: { batchId: task.batchId, courierId: actor.courier.id, status: 'ASSIGNED' },
        })
      : [task];

    const manual = qr === null;
    const confirmed = new Map<string, number>();
    if (!manual) {
      for (const t of group) {
        if (t.kind === 'EXTRA_TRIP') continue;
        // У заказа из Poster состав — в снимке, своих строк заказа нет
        const items = t.orderId
          ? await this.prisma.orderItem.findMany({
              where: { orderId: t.orderId, isUnavailable: false },
              select: { id: true },
            })
          : orderOf(t).items.map((i) => ({ id: i.id }));
        // Состав могли поменять, пока курьер отмечал (кассир снял позицию,
        // добавил замену) — тогда пусть сверит ещё раз по свежему списку
        if (missingItems(items, confirmedItemIds).length > 0) {
          throw new BadRequestException('Состав заказа обновился. Отметьте все позиции ещё раз');
        }
        confirmed.set(t.id, items.length);
      }
      const venueId = await this.venueFromQr(actor.tenantId, qr);
      if (venueId !== task.venueId) throw new BadRequestException('Это QR другой точки');
    }
    const now = new Date();
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: { in: group.map((t) => t.id) }, status: 'ASSIGNED', courierId: actor.courier.id },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: now,
        pickupMethod: manual ? 'MANUAL' : 'SCAN',
        ...(manual ? { flags: { push: 'MANUAL_PICKUP' } } : {}),
      },
    });
    if (changed.count === 0) throw new BadRequestException('Этот заказ уже не ваш');
    if (task.shiftId) {
      await this.prisma.courierShift.update({
        where: { id: task.shiftId },
        data: { state: 'ON_DELIVERY' },
      });
    }
    for (const t of group) {
      const n = confirmed.get(t.id);
      await this.event(actor, t.id, 'PICKED_UP', {
        method: manual ? 'MANUAL' : 'SCAN',
        ...(n !== undefined ? { itemsConfirmed: n } : {}),
        ...(t.batchId ? { batchSeq: t.batchSeq } : {}),
      });
    }
    return this.me(actor);
  }

  // ─── «Доставлен» и «Не удалось» ────────────────────────────────

  async delivered(actor: CourierActorValue, taskId: string, lat?: number, lng?: number) {
    const task = await this.ownTask(actor, taskId);
    if (task.status === 'DELIVERED') return this.me(actor);
    if (task.status !== 'PICKED_UP') throw new BadRequestException('Сначала отметьте «Забрал»');
    await this.assertBatchOrder(actor, task);

    const cfg = courierSettings(actor.tenantSettings);
    const now = new Date();
    const done = await this.prisma.$transaction((tx) =>
      completeDelivery(tx, {
        tenantId: actor.tenantId,
        task,
        courierId: actor.courier.id,
        shiftId: task.shiftId,
        from: ['PICKED_UP'],
        currentCourierId: actor.courier.id,
        deliveryPay: cfg.deliveryPay,
        now,
        handoffMethod: 'BUTTON',
        data: { handoffLat: lat ?? null, handoffLng: lng ?? null },
      }),
    );
    if (!done) return this.me(actor);
    await this.afterTrip(actor, task.shiftId, now);
    await this.event(actor, taskId, 'DELIVERED', lat != null ? { lat, lng } : undefined);
    return this.me(actor);
  }

  async failed(actor: CourierActorValue, taskId: string, reason: string) {
    const task = await this.ownTask(actor, taskId);
    if (task.status !== 'PICKED_UP') throw new BadRequestException('Сначала отметьте «Забрал»');
    const now = new Date();
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: 'PICKED_UP', courierId: actor.courier.id },
      data: { status: 'FAILED', failedReason: reason, deliveredAt: now },
    });
    if (changed.count === 0) return this.me(actor);
    await this.afterTrip(actor, task.shiftId, now);
    await this.event(actor, taskId, 'FAILED', { reason });

    const chat = await this.telegram.cashierTargetChat(actor.tenantId);
    if (chat) {
      await this.telegram.call(actor.tenantId, 'sendMessage', {
        chat_id: chat,
        parse_mode: 'HTML',
        text:
          `⚠️ <b>Курьер не смог доставить №${orderOf(task).number}</b>\n` +
          `${esc(actor.courier.fullName)}: ${esc(reason)}\n\n` +
          'Свяжитесь с клиентом и решите, что делать с заказом. Курьер везёт его обратно.',
      });
    }
    return this.me(actor);
  }

  /**
   * Номер клиента сообщением от бота. В части телефонов Telegram не даёт
   * Mini App открыть звонилку по tel:, а номер в чате нажимается всегда.
   */
  async sendPhone(actor: CourierActorValue, taskId: string) {
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: taskId, courierId: actor.courier.id, status: 'PICKED_UP' },
      include: { order: { select: { number: true, customer: { select: { phone: true, name: true } } } } },
    });
    if (!task) throw new NotFoundException('Заказ не найден');
    const o = orderOf(task);
    if (!o.phone) throw new BadRequestException('У заказа нет телефона');
    const { error } = await this.telegram.call(actor.tenantId, 'sendMessage', {
      chat_id: actor.courier.telegramUserId,
      parse_mode: 'HTML',
      text:
        `📞 <b>Клиент №${esc(o.number)}</b>${o.customerName ? `, ${esc(o.customerName)}` : ''}\n` +
        `${telNumber(o.phone)}\n\nНажмите на номер, чтобы позвонить.`,
    });
    if (error) throw new BadRequestException('Телеграм не принял сообщение, попробуйте ещё раз');
    return { sent: true };
  }

  // ─── Конец смены ───────────────────────────────────────────────

  async endShift(actor: CourierActorValue) {
    const shift = await this.openShift(actor.courier.id);
    if (!shift) return this.me(actor);
    const active = await this.prisma.deliveryTask.findFirst({
      where: { courierId: actor.courier.id, status: { in: [...ACTIVE_TASK] } },
      include: { order: { select: { number: true } } },
    });
    if (active) {
      throw new BadRequestException(`Сначала завершите №${orderOf(active).number}`);
    }
    await this.closeShift(actor, shift.id, 'COURIER');
    // Взаимозачёт: кто кому сколько отдаёт — карточкой в чат кассы
    await this.cash.createSettlement(actor.tenantId, actor.courier, shift.id);
    return this.me(actor);
  }

  // ─── Вспомогательное ───────────────────────────────────────────

  private openShift(courierId: string) {
    return this.prisma.courierShift.findFirst({ where: { courierId, endedAt: null } });
  }

  private async closeShift(actor: CourierActorValue, shiftId: string, by: 'COURIER' | 'AUTO') {
    const closed = await this.prisma.courierShift.updateMany({
      where: { id: shiftId, endedAt: null },
      data: { endedAt: new Date(), endedBy: by, state: 'AWAY' },
    });
    if (closed.count === 0) return;
    await this.prisma.courier.update({
      where: { id: actor.courier.id },
      data: { completedShifts: { increment: 1 } },
    });
    await this.prisma.deliveryTaskEvent.create({
      data: {
        tenantId: actor.tenantId,
        shiftId,
        courierId: actor.courier.id,
        type: 'SHIFT_END',
        actor: by === 'COURIER' ? `COURIER:${actor.courier.id}` : 'SYSTEM',
      },
    });
  }

  /** После поездки: ещё есть заказы связки — везёт дальше, иначе возвращается */
  private async afterTrip(actor: CourierActorValue, shiftId: string | null, now: Date) {
    if (!shiftId) return;
    const more = await this.prisma.deliveryTask.count({
      where: { courierId: actor.courier.id, status: 'PICKED_UP' },
    });
    await this.prisma.courierShift.update({
      where: { id: shiftId },
      data: more > 0 ? { lastDeliveredAt: now } : { state: 'RETURNING', lastDeliveredAt: now },
    });
  }

  private async venueFromQr(tenantId: string, qr: string) {
    const venueId = verifyQrToken(qr);
    if (!venueId) throw new BadRequestException('Код устарел или не тот. Отсканируйте QR ещё раз');
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId } });
    if (!venue) throw new BadRequestException('Это QR другого заведения');
    return venueId;
  }

  // ─── Фото в очереди ────────────────────────────────────────────

  /**
   * Селфи коллеги для очереди. Только тем, кто сейчас на смене у той же
   * раздачи, и только тех, кто тоже на смене: фото не каталог курьеров.
   */
  async photo(actor: CourierActorValue, courierId: string) {
    const mine = await this.openShift(actor.courier.id);
    if (!mine || actor.courier.status !== 'ACTIVE') throw new NotFoundException('Нет фото');
    const theirs = await this.prisma.courierShift.findFirst({
      where: { venueId: mine.venueId, endedAt: null, courierId, tenantId: actor.tenantId },
      select: { courier: { select: { selfieFileId: true } } },
    });
    const fileId = theirs?.courier.selfieFileId;
    if (!fileId) throw new NotFoundException('Нет фото');
    const file = await this.photos.get(actor.tenantId, fileId);
    if (!file) throw new NotFoundException('Нет фото');
    return file;
  }

  /** Адрес заказа с координатами из справочника города, если своих нет */
  private async withCoords(tenantSlug: string, raw: unknown): Promise<Address | null> {
    const addr = (raw as Address | null) ?? null;
    if (!addr || (typeof addr.lat === 'number' && typeof addr.lng === 'number')) return addr;
    const point = await this.geo
      .coordsOf(tenantSlug, addr.street ?? '', addr.house ?? '')
      .catch(() => null);
    return point ? { ...addr, ...point } : addr;
  }

  /** Второй заказ связки закрывается только после первого */
  private async assertBatchOrder(
    actor: CourierActorValue,
    task: { id: string; batchId: string | null; batchSeq: number | null },
  ) {
    if (!task.batchId) return;
    const before = await this.prisma.deliveryTask.findFirst({
      where: {
        batchId: task.batchId,
        courierId: actor.courier.id,
        status: 'PICKED_UP',
        id: { not: task.id },
        batchSeq: { lt: task.batchSeq ?? 0 },
      },
      include: { order: { select: { number: true } } },
    });
    if (before) throw new BadRequestException(`Сначала доставьте №${orderOf(before).number}`);
  }

  private async ownTask(actor: CourierActorValue, taskId: string) {
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: taskId, courierId: actor.courier.id },
      include: { order: { select: { number: true } } },
    });
    if (!task) throw new NotFoundException('Заказ не найден');
    return task;
  }

  private event(
    actor: CourierActorValue,
    taskId: string,
    type: string,
    meta?: Prisma.InputJsonValue,
  ) {
    return this.prisma.deliveryTaskEvent.create({
      data: {
        tenantId: actor.tenantId,
        taskId,
        courierId: actor.courier.id,
        type,
        actor: `COURIER:${actor.courier.id}`,
        ...(meta !== undefined ? { meta } : {}),
      },
    });
  }
}

export function formatAddress(a: Address): string {
  const main = [a.street, a.house].filter(Boolean).join(', ');
  const extra = [
    a.entrance && `подъезд ${a.entrance}`,
    a.floor && `этаж ${a.floor}`,
    a.flat && `кв. ${a.flat}`,
  ]
    .filter(Boolean)
    .join(', ');
  return [main, extra].filter(Boolean).join('; ');
}

/**
 * Ссылка в 2ГИС. С координатами — сразу маршрут: начало пустое, его 2ГИС
 * берёт из местоположения телефона. Без координат — поиск по адресу, и тут
 * нужен город: без него 2ГИС ищет в городе, который угадал по IP (для
 * Экибастуза это Павлодар).
 */
export function mapUrl(a: Address, city = ''): string | null {
  if (typeof a.lat === 'number' && typeof a.lng === 'number') {
    return `https://2gis.kz/directions/points/${encodeURIComponent(`|${a.lng},${a.lat}`)}`;
  }
  const street = [a.street, a.house].filter(Boolean).join(' ');
  if (!street) return null;
  const q = city && !street.toLowerCase().includes(city.toLowerCase()) ? `${city} ${street}` : street;
  return `https://2gis.kz/search/${encodeURIComponent(q)}`;
}

/** Город точки — первая часть её адреса: «Экибастуз, Ауэзова 47б, …» */
export function cityOf(venueAddress: string): string {
  const [first, ...rest] = venueAddress.split(',');
  // Адрес без запятой — это улица, а не город
  return rest.length > 0 ? first.trim() : '';
}

type ChecklistItem = {
  id: string;
  name: string;
  qty: number;
  modifiers: unknown;
  isGift: boolean;
  isUnavailable: boolean;
};

/** Строки для галочек: что лежит в пакете, с добавками мелким шрифтом */
export function checklist(items: ChecklistItem[]) {
  return items
    .filter((i) => !i.isUnavailable)
    .map((i) => {
      const mods = Array.isArray(i.modifiers)
        ? i.modifiers
            .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown }).name : null))
            .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : [];
      return {
        id: i.id,
        name: i.name,
        qty: i.qty,
        note: [...mods, ...(i.isGift ? ['подарок'] : [])].join(', '),
      };
    });
}

/**
 * Первый заказ связки, который ещё в пути, — если `t` идёт после него.
 * Пока он не доставлен, адрес второго курьеру не показываем.
 */
export function nextInBatch<
  T extends { id: string; status: string; batchId: string | null; batchSeq: number | null },
>(t: T, all: T[]): T | null {
  if (!t.batchId || t.batchSeq == null) return null;
  return (
    all.find(
      (o) =>
        o.id !== t.id &&
        o.batchId === t.batchId &&
        o.status === t.status &&
        o.batchSeq != null &&
        o.batchSeq < t.batchSeq!,
    ) ?? null
  );
}

/** Каких позиций курьер не отметил */
export function missingItems(items: { id: string }[], confirmed: string[]): string[] {
  const seen = new Set(confirmed);
  return items.filter((i) => !seen.has(i.id)).map((i) => i.id);
}

/** Начало суток по часовому поясу сервера (TZ=Asia/Almaty на Railway) */
function startOfDay(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

type QueueShift = {
  state: string;
  scheduled: boolean;
  queuedAt: Date | null;
  pauseUntil: Date | null;
  courier: { id: string; fullName: string; selfieFileId: string | null };
  tasks: { pickedUpAt: Date | null }[];
};

/**
 * Очередь для экрана курьера в порядке, в котором раздаются заказы:
 * сначала ждущие (график, потом время скана), затем в пути, затем пауза.
 */
export function buildQueue(shifts: QueueShift[], meId: string, now = new Date()) {
  const person = (s: QueueShift) => ({
    id: s.courier.id,
    name: shortName(s.courier.fullName),
    photo: Boolean(s.courier.selfieFileId),
    me: s.courier.id === meId,
  });
  const time = (d: Date | null) => d?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const minutes = (from: Date | null, to: Date) =>
    from ? Math.max(Math.floor((to.getTime() - from.getTime()) / 60_000), 0) : null;

  const waiting = shifts
    .filter((s) => s.state === 'WAITING')
    .sort((a, b) => Number(b.scheduled) - Number(a.scheduled) || time(a.queuedAt) - time(b.queuedAt))
    .map(person);
  const onWay = shifts
    .filter((s) => ['ASSIGNED', 'ON_DELIVERY', 'RETURNING'].includes(s.state))
    .sort((a, b) => time(a.tasks[0]?.pickedUpAt ?? null) - time(b.tasks[0]?.pickedUpAt ?? null))
    .map((s) => ({
      ...person(s),
      state: s.state as 'ASSIGNED' | 'ON_DELIVERY' | 'RETURNING',
      minutes: s.state === 'ON_DELIVERY' ? minutes(s.tasks[0]?.pickedUpAt ?? null, now) : null,
    }));
  const pause = shifts
    .filter((s) => s.state === 'ON_PAUSE')
    .sort((a, b) => time(a.pauseUntil) - time(b.pauseUntil))
    .map((s) => ({
      ...person(s),
      minutesLeft: s.pauseUntil
        ? Math.max(Math.ceil((s.pauseUntil.getTime() - now.getTime()) / 60_000), 0)
        : null,
    }));
  return { waiting, onWay, pause };
}
