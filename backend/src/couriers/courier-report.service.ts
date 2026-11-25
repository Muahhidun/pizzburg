import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { shortName } from './names';
import { orderOf } from './task-order';

/**
 * Отчёт по доставкам курьерского модуля (ТЗ §14).
 *
 * Зачем: по нему решаем, сколько курьеров нужно по часам и дням, и видим,
 * где теряются минуты — на кухне, в ожидании курьера или в дороге.
 *
 * Этапы заказа:
 * - «кухня» — от оформления до «Готов» на планшете;
 * - «ждал курьера» — от «Готов» до «Поехали»;
 * - «в пути» — от «Поехали» до «Доставлен»;
 * - «всего» — от оформления до «Доставлен».
 * Предзаказы в «кухню» и «всего» не входят: их время задаёт клиент.
 *
 * Часы и дни — по времени сервера (оно же время заведения).
 */

export type ReportTask = {
  id: string;
  kind: string;
  status: string;
  courierId: string | null;
  courierName: string | null;
  batchId: string | null;
  pickupMethod: string | null;
  /** DISPATCH — «Доставлен» отметила раздача */
  handoffMethod?: string | null;
  number: string;
  /** APP — наш заказ, POSTER — старое приложение или сайт через Poster */
  source?: string;
  orderAt: Date;
  scheduled: boolean;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
};

export type ReportShift = {
  courierId: string;
  courierName: string;
  startedAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
};

export type ReportEvent = { type: string; courierId: string | null };

export type ReportPayout = { courierId: string; amount: number };

const min = (a: Date | null, b: Date | null) =>
  a && b && b >= a ? (b.getTime() - a.getTime()) / 60_000 : null;

function stats(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, avg: null, median: null };
  const avg = v.reduce((s, x) => s + x, 0) / v.length;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { count: v.length, avg: round(avg), median: round(median) };
}

const round = (x: number) => Math.round(x * 10) / 10;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Часы смены, попавшие в период */
function shiftHours(s: ReportShift, from: Date, to: Date, now: Date) {
  const start = Math.max(s.startedAt.getTime(), from.getTime());
  const end = Math.min((s.endedAt ?? now).getTime(), to.getTime());
  return end > start ? (end - start) / 3_600_000 : 0;
}

export function buildDeliveryReport(input: {
  from: Date;
  to: Date;
  now?: Date;
  tasks: ReportTask[];
  shifts: ReportShift[];
  events: ReportEvent[];
  payouts: ReportPayout[];
  /** Лимит длинного списка доставок */
  listLimit?: number;
}) {
  const { from, to, tasks, shifts, events, payouts } = input;
  const now = input.now ?? new Date();
  const delivered = tasks.filter((t) => t.status === 'DELIVERED');
  // Отметки раздачи задним числом (у планшета не было связи): время
  // нажатия, а не события, — в сроки их не берём, только в счёт
  const marked = (t: ReportTask) => t.pickupMethod === 'DISPATCH' || t.handoffMethod === 'DISPATCH';
  const stage = (t: ReportTask) => {
    const pickedLate = t.pickupMethod === 'DISPATCH';
    const deliveredLate = t.handoffMethod === 'DISPATCH';
    return {
      kitchen: t.scheduled || (pickedLate && deliveredLate) ? null : min(t.orderAt, t.readyAt),
      wait: pickedLate ? null : min(t.readyAt, t.pickedUpAt),
      onWay: pickedLate || deliveredLate ? null : min(t.pickedUpAt, t.deliveredAt),
      total: t.scheduled || deliveredLate ? null : min(t.orderAt, t.deliveredAt),
    };
  };
  const totals = delivered.map((t) => stage(t).total).filter((x): x is number => x !== null);
  const share = (limit: number, list: number[]) =>
    list.length ? Math.round((list.filter((x) => x <= limit).length / list.length) * 100) : null;
  const count = (type: string, courierId?: string) =>
    events.filter((e) => e.type === type && (!courierId || e.courierId === courierId)).length;

  const summary = {
    delivered: delivered.length,
    deliveredFromPoster: delivered.filter((t) => t.source === 'POSTER').length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
    inProgress: tasks.filter((t) => ['NEW', 'READY', 'ASSIGNED', 'PICKED_UP'].includes(t.status)).length,
    extraTrips: tasks.filter((t) => t.kind === 'EXTRA_TRIP').length,
    batches: new Set(tasks.map((t) => t.batchId).filter(Boolean)).size,
    manualPickups: tasks.filter((t) => t.pickupMethod === 'MANUAL').length,
    scanPickups: tasks.filter((t) => t.pickupMethod === 'SCAN').length,
    dispatchMarked: tasks.filter(marked).length,
    pickupTimeouts: count('PICKUP_TIMEOUT'),
    courierLeft: count('COURIER_LEFT'),
    couriers: new Set(shifts.map((s) => s.courierId)).size,
    shifts: shifts.length,
    shiftsClosedByCourier: shifts.filter((s) => s.endedBy === 'COURIER').length,
    shiftsClosedAuto: shifts.filter((s) => s.endedBy === 'AUTO').length,
    shiftsClosedByDispatch: shifts.filter((s) => s.endedBy === 'DISPATCH').length,
    shiftsOpen: shifts.filter((s) => !s.endedAt).length,
    within60: share(60, totals),
    within45: share(45, totals),
    kitchen: stats(delivered.map((t) => stage(t).kitchen)),
    wait: stats(delivered.map((t) => stage(t).wait)),
    onWay: stats(delivered.map((t) => stage(t).onWay)),
    total: stats(delivered.map((t) => stage(t).total)),
  };

  // По дням периода
  const days: string[] = [];
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  const byDay = days.map((day) => {
    const list = delivered.filter((t) => dayKey(t.orderAt) === day);
    const dayTotals = list.map((t) => stage(t).total).filter((x): x is number => x !== null);
    return {
      day,
      delivered: list.length,
      couriers: new Set(shifts.filter((s) => dayKey(s.startedAt) === day).map((s) => s.courierId)).size,
      total: stats(list.map((t) => stage(t).total)).avg,
      wait: stats(list.map((t) => stage(t).wait)).avg,
      onWay: stats(list.map((t) => stage(t).onWay)).avg,
      within60: share(60, dayTotals),
    };
  });

  // По часам: заказы и сколько курьеров было на смене в этот час (в среднем за день)
  const dayCount = Math.max(days.length, 1);
  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const list = tasks.filter((t) => t.kind === 'DELIVERY' && t.orderAt.getHours() === hour);
    const done = list.filter((t) => t.status === 'DELIVERED');
    let courierHours = 0;
    for (const day of days) {
      const [y, m, d] = day.split('-').map(Number);
      const slotFrom = new Date(y, m - 1, d, hour);
      const slotTo = new Date(y, m - 1, d, hour + 1);
      for (const s of shifts) courierHours += shiftHours(s, slotFrom, slotTo, now);
    }
    return {
      hour,
      orders: list.length,
      ordersPerDay: round(list.length / dayCount),
      couriersOnShift: round(courierHours / dayCount),
      total: stats(done.map((t) => stage(t).total)).avg,
      wait: stats(done.map((t) => stage(t).wait)).avg,
    };
  }).filter((h) => h.orders > 0 || h.couriersOnShift > 0);

  // По курьерам
  const ids = [...new Set([...shifts.map((s) => s.courierId), ...tasks.map((t) => t.courierId).filter((x): x is string => !!x)])];
  const nameOf = (id: string) =>
    shifts.find((s) => s.courierId === id)?.courierName ??
    tasks.find((t) => t.courierId === id)?.courierName ??
    '—';
  const byCourier = ids
    .map((id) => {
      const mine = tasks.filter((t) => t.courierId === id);
      const done = mine.filter((t) => t.status === 'DELIVERED');
      const myShifts = shifts.filter((s) => s.courierId === id);
      return {
        courierId: id,
        name: nameOf(id),
        delivered: done.length,
        failed: mine.filter((t) => t.status === 'FAILED').length,
        extraTrips: done.filter((t) => t.kind === 'EXTRA_TRIP').length,
        batches: new Set(mine.map((t) => t.batchId).filter(Boolean)).size,
        manualPickups: mine.filter((t) => t.pickupMethod === 'MANUAL').length,
        dispatchMarked: mine.filter(marked).length,
        pickupTimeouts: count('PICKUP_TIMEOUT', id),
        left: count('COURIER_LEFT', id),
        onWay: stats(done.map((t) => stage(t).onWay)).avg,
        wait: stats(done.map((t) => stage(t).wait)).avg,
        shifts: myShifts.length,
        shiftsNotClosed: myShifts.filter((s) => s.endedBy !== 'COURIER').length,
        hours: round(myShifts.reduce((h, s) => h + shiftHours(s, from, to, now), 0)),
        earned: payouts.filter((p) => p.courierId === id).reduce((n, p) => n + p.amount, 0),
      };
    })
    .sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));

  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const list = [...tasks]
    .sort((a, b) => b.orderAt.getTime() - a.orderAt.getTime())
    .slice(0, input.listLimit ?? 300)
    .map((t) => {
      const s = stage(t);
      return {
        id: t.id,
        number: t.number,
        source: t.source ?? 'APP',
        kind: t.kind,
        status: t.status,
        courier: t.courierName,
        batch: !!t.batchId,
        pickupMethod: t.pickupMethod,
        dispatchMarked: marked(t),
        scheduled: t.scheduled,
        orderAt: iso(t.orderAt),
        readyAt: iso(t.readyAt),
        pickedUpAt: iso(t.pickedUpAt),
        deliveredAt: iso(t.deliveredAt),
        kitchen: s.kitchen === null ? null : Math.round(s.kitchen),
        wait: s.wait === null ? null : Math.round(s.wait),
        onWay: s.onWay === null ? null : Math.round(s.onWay),
        total: s.total === null ? null : Math.round(s.total),
      };
    });

  return { from: from.toISOString(), to: to.toISOString(), summary, byDay, byHour, byCourier, list };
}

@Injectable()
export class CourierReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(tenantId: string, from: Date, to: Date) {
    const [tasks, shifts, events, payouts] = await Promise.all([
      this.prisma.deliveryTask.findMany({
        where: {
          tenantId,
          kind: { in: ['DELIVERY', 'EXTRA_TRIP'] },
          status: { not: 'CANCELLED' },
          createdAt: { gte: from, lt: to },
        },
        include: {
          courier: { select: { fullName: true } },
          order: { select: { number: true, createdAt: true, scheduledAt: true } },
        },
      }),
      this.prisma.courierShift.findMany({
        where: { tenantId, startedAt: { lt: to }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
        include: { courier: { select: { fullName: true } } },
      }),
      this.prisma.deliveryTaskEvent.findMany({
        where: {
          tenantId,
          at: { gte: from, lt: to },
          type: { in: ['PICKUP_TIMEOUT', 'COURIER_LEFT', 'READY_UNDONE'] },
        },
        select: { type: true, courierId: true },
      }),
      this.prisma.courierPayoutLine.findMany({
        where: { tenantId, createdAt: { gte: from, lt: to } },
        select: { courierId: true, amount: true },
      }),
    ]);

    return buildDeliveryReport({
      from,
      to,
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        courierId: t.courierId,
        courierName: t.courier ? shortName(t.courier.fullName) : null,
        batchId: t.batchId,
        pickupMethod: t.pickupMethod,
        handoffMethod: t.handoffMethod,
        number: orderOf(t).number,
        source: t.source,
        // Довоз считаем от его создания, а не от исходного заказа
        orderAt: t.kind === 'EXTRA_TRIP' ? t.createdAt : orderOf(t).createdAt,
        scheduled: t.kind !== 'EXTRA_TRIP' && !!orderOf(t).scheduledAt,
        readyAt: t.readyAt,
        pickedUpAt: t.pickedUpAt,
        deliveredAt: t.deliveredAt,
      })),
      shifts: shifts.map((s) => ({
        courierId: s.courierId,
        courierName: shortName(s.courier.fullName),
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        endedBy: s.endedBy,
      })),
      events,
      payouts,
    });
  }
}
