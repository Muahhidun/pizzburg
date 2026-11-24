'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatTenge, todayLocal } from '@/lib/api';

/**
 * Отчёт по доставкам курьерского модуля (ТЗ §14).
 *
 * Главное — понять, сколько курьеров нужно по часам и дням и где теряются
 * минуты: на кухне, в ожидании курьера или в дороге. Сюда попадают только
 * заказы, прошедшие через планшет раздачи.
 */

type Stat = { count: number; avg: number | null; median: number | null };

type Report = {
  summary: {
    delivered: number;
    deliveredFromPoster: number;
    failed: number;
    inProgress: number;
    extraTrips: number;
    batches: number;
    manualPickups: number;
    scanPickups: number;
    pickupTimeouts: number;
    courierLeft: number;
    couriers: number;
    shifts: number;
    shiftsClosedByCourier: number;
    shiftsClosedAuto: number;
    shiftsClosedByDispatch: number;
    shiftsOpen: number;
    within60: number | null;
    within45: number | null;
    kitchen: Stat;
    wait: Stat;
    onWay: Stat;
    total: Stat;
  };
  byDay: {
    day: string;
    delivered: number;
    couriers: number;
    total: number | null;
    wait: number | null;
    onWay: number | null;
    within60: number | null;
  }[];
  byHour: {
    hour: number;
    orders: number;
    ordersPerDay: number;
    couriersOnShift: number;
    total: number | null;
    wait: number | null;
  }[];
  byCourier: {
    courierId: string;
    name: string;
    delivered: number;
    failed: number;
    extraTrips: number;
    batches: number;
    manualPickups: number;
    pickupTimeouts: number;
    left: number;
    onWay: number | null;
    wait: number | null;
    shifts: number;
    shiftsNotClosed: number;
    hours: number;
    earned: number;
  }[];
  list: {
    id: string;
    number: string;
    source: string;
    kind: string;
    status: string;
    courier: string | null;
    batch: boolean;
    pickupMethod: string | null;
    scheduled: boolean;
    orderAt: string;
    readyAt: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    kitchen: number | null;
    wait: number | null;
    onWay: number | null;
    total: number | null;
  }[];
};

const STATUS: Record<string, string> = {
  NEW: 'готовится',
  READY: 'ждёт курьера',
  ASSIGNED: 'курьер идёт',
  PICKED_UP: 'в пути',
  DELIVERED: 'доставлен',
  FAILED: 'не доставлен',
};

function shiftDays(base: string, days: number) {
  const [y, m, d] = base.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const mins = (v: number | null) => (v === null ? '—' : `${Math.round(v)} мин`);
const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });

export default function DeliveriesReportPage() {
  const today = todayLocal();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [courier, setCourier] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setReport(await api.get<Report>(`/admin/reports/deliveries?from=${from}&to=${to}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const presets: { label: string; from: string; to: string }[] = [
    { label: 'Сегодня', from: today, to: today },
    { label: 'Вчера', from: shiftDays(today, -1), to: shiftDays(today, -1) },
    { label: '7 дней', from: shiftDays(today, -6), to: today },
    { label: '30 дней', from: shiftDays(today, -29), to: today },
  ];

  const courierName = report?.byCourier.find((c) => c.courierId === courier)?.name ?? null;
  const list = useMemo(
    () => (report ? report.list.filter((d) => !courierName || d.courier === courierName) : []),
    [report, courierName],
  );
  const maxHour = Math.max(1, ...(report?.byHour.map((h) => Math.max(h.ordersPerDay, h.couriersOnShift)) ?? [1]));
  const s = report?.summary;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Доставки</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Заказы, прошедшие через планшет раздачи, — наши и старого приложения (из Poster, с 25.11).
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              from === p.from && to === p.to
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'bg-black/5 dark:bg-white/10'
            }`}
          >
            {p.label}
          </button>
        ))}
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
        />
        <span className="text-neutral-400">—</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">{error}</p>
      )}

      {s && report && (
        <>
          <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Доставлено" value={String(s.delivered)} hint={`из них старое прил. ${s.deliveredFromPoster} · не удалось ${s.failed}`} />
            <Tile
              label="До 60 минут"
              value={s.within60 === null ? '—' : `${s.within60}%`}
              hint={s.within45 === null ? '' : `до 45 мин ${s.within45}%`}
            />
            <Tile label="Всего от заказа" value={mins(s.total.median)} hint={`медиана · среднее ${mins(s.total.avg)}`} />
            <Tile label="Курьеров" value={String(s.couriers)} hint={`смен ${s.shifts}`} />
          </section>

          <section className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">Где уходит время</h2>
            <p className="text-sm text-neutral-500">Медиана по доставленным; предзаказы не учитываются</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stage label="Кухня" sub="от заказа до «Готов»" stat={s.kitchen} />
              <Stage label="Ждал курьера" sub="от «Готов» до «Поехали»" stat={s.wait} />
              <Stage label="В пути" sub="от «Поехали» до «Доставлен»" stat={s.onWay} />
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">Порядок у раздачи</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              <Row k="Забрали со сканом QR" v={s.scanPickups} />
              <Row k="«Уехал, забыл отсканировать»" v={s.manualPickups} warn={s.manualPickups > 0} />
              <Row k="Не пришли за заказом (10 мин)" v={s.pickupTimeouts} warn={s.pickupTimeouts > 0} />
              <Row k="Раздача отметила «Уехал»" v={s.courierLeft} />
              <Row k="Связок по 2 заказа" v={s.batches} />
              <Row k="Довозов" v={s.extraTrips} warn={s.extraTrips > 0} />
              <Row k="Смену закрыл сам" v={s.shiftsClosedByCourier} />
              <Row k="Смену закрыла система ночью" v={s.shiftsClosedAuto} warn={s.shiftsClosedAuto > 0} />
              <Row k="Смену закрыла раздача" v={s.shiftsClosedByDispatch} />
              <Row k="Смена ещё открыта" v={s.shiftsOpen} />
            </dl>
          </section>

          <section className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">По часам</h2>
            <p className="text-sm text-neutral-500">
              Заказов в час и курьеров на смене — в среднем за день периода. Где заказов много, а курьеров мало,
              нужны люди.
            </p>
            <div className="mt-3 space-y-1.5">
              {report.byHour.map((h) => (
                <div key={h.hour} className="grid grid-cols-[3rem_1fr_12rem] items-center gap-2 text-sm">
                  <span className="tabular-nums text-neutral-500">{String(h.hour).padStart(2, '0')}:00</span>
                  <div className="space-y-0.5">
                    <div
                      className="h-2.5 rounded bg-amber-500"
                      style={{ width: `${(h.ordersPerDay / maxHour) * 100}%` }}
                      title={`заказов ${h.ordersPerDay}`}
                    />
                    <div
                      className="h-2.5 rounded bg-sky-500"
                      style={{ width: `${(h.couriersOnShift / maxHour) * 100}%` }}
                      title={`курьеров ${h.couriersOnShift}`}
                    />
                  </div>
                  <span className="tabular-nums">
                    {h.ordersPerDay} зак · {h.couriersOnShift} кур
                    {h.wait !== null && <span className="text-neutral-500"> · ждали {Math.round(h.wait)}</span>}
                  </span>
                </div>
              ))}
              {report.byHour.length === 0 && <p className="text-sm text-neutral-500">Нет данных</p>}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-neutral-500">
              <span>
                <span className="mr-1 inline-block h-2 w-3 rounded bg-amber-500" />
                заказов
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-3 rounded bg-sky-500" />
                курьеров на смене
              </span>
            </div>
          </section>

          {report.byDay.length > 1 && (
            <section className="mt-5 overflow-x-auto rounded-xl border border-black/10 p-4 dark:border-white/10">
              <h2 className="font-semibold">По дням</h2>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-1 pr-3 font-normal">День</th>
                    <th className="py-1 pr-3 font-normal">Доставлено</th>
                    <th className="py-1 pr-3 font-normal">Курьеров</th>
                    <th className="py-1 pr-3 font-normal">Всего</th>
                    <th className="py-1 pr-3 font-normal">Ждали курьера</th>
                    <th className="py-1 pr-3 font-normal">В пути</th>
                    <th className="py-1 font-normal">До 60 мин</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byDay.map((d) => (
                    <tr key={d.day} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-1 pr-3">{dayLabel(d.day)}</td>
                      <td className="py-1 pr-3 tabular-nums">{d.delivered}</td>
                      <td className="py-1 pr-3 tabular-nums">{d.couriers}</td>
                      <td className="py-1 pr-3 tabular-nums">{mins(d.total)}</td>
                      <td className="py-1 pr-3 tabular-nums">{mins(d.wait)}</td>
                      <td className="py-1 pr-3 tabular-nums">{mins(d.onWay)}</td>
                      <td className="py-1 tabular-nums">{d.within60 === null ? '—' : `${d.within60}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-5 overflow-x-auto rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">По курьерам</h2>
            <p className="text-sm text-neutral-500">Нажмите на курьера, чтобы увидеть только его доставки</p>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Курьер</th>
                  <th className="py-1 pr-3 font-normal">Доставок</th>
                  <th className="py-1 pr-3 font-normal">В пути, сред.</th>
                  <th className="py-1 pr-3 font-normal">Часов на смене</th>
                  <th className="py-1 pr-3 font-normal">Смен / не закрыл</th>
                  <th className="py-1 pr-3 font-normal">Без скана</th>
                  <th className="py-1 pr-3 font-normal">Не пришёл</th>
                  <th className="py-1 pr-3 font-normal">Связок</th>
                  <th className="py-1 font-normal">Начислено</th>
                </tr>
              </thead>
              <tbody>
                {report.byCourier.map((c) => (
                  <tr
                    key={c.courierId}
                    onClick={() => setCourier(courier === c.courierId ? null : c.courierId)}
                    className={`cursor-pointer border-t border-black/5 dark:border-white/10 ${
                      courier === c.courierId ? 'bg-amber-50 dark:bg-amber-950/40' : ''
                    }`}
                  >
                    <td className="py-1 pr-3 font-medium">{c.name}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      {c.delivered}
                      {c.failed > 0 && <span className="text-red-600"> (+{c.failed} не удалось)</span>}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{mins(c.onWay)}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.hours}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      {c.shifts} / <span className={c.shiftsNotClosed ? 'text-amber-600' : ''}>{c.shiftsNotClosed}</span>
                    </td>
                    <td className={`py-1 pr-3 tabular-nums ${c.manualPickups ? 'text-amber-600' : ''}`}>{c.manualPickups}</td>
                    <td className={`py-1 pr-3 tabular-nums ${c.pickupTimeouts ? 'text-red-600' : ''}`}>{c.pickupTimeouts}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.batches}</td>
                    <td className="py-1 tabular-nums">{formatTenge(c.earned)}</td>
                  </tr>
                ))}
                {report.byCourier.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-2 text-neutral-500">
                      Нет курьеров за период
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="mt-5 overflow-x-auto rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h2 className="font-semibold">
              Заказы{courierName ? ` · ${courierName}` : ''}{' '}
              <span className="font-normal text-neutral-500">{list.length}</span>
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">№</th>
                  <th className="py-1 pr-3 font-normal">Курьер</th>
                  <th className="py-1 pr-3 font-normal">Заказ</th>
                  <th className="py-1 pr-3 font-normal">Готов</th>
                  <th className="py-1 pr-3 font-normal">Поехал</th>
                  <th className="py-1 pr-3 font-normal">Доставлен</th>
                  <th className="py-1 pr-3 font-normal">Кухня / ждал / путь</th>
                  <th className="py-1 font-normal">Всего</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="py-1 pr-3 tabular-nums">
                      {d.number}
                      {d.source === 'POSTER' && <span className="ml-1 text-xs text-neutral-500">старое</span>}
                      {d.kind === 'EXTRA_TRIP' && <span className="ml-1 text-xs text-amber-600">довоз</span>}
                      {d.batch && <span className="ml-1 text-xs text-sky-600">связка</span>}
                      {d.scheduled && <span className="ml-1 text-xs text-neutral-500">предзаказ</span>}
                    </td>
                    <td className="py-1 pr-3">{d.courier ?? '—'}</td>
                    <td className="py-1 pr-3 tabular-nums">{clock(d.orderAt)}</td>
                    <td className="py-1 pr-3 tabular-nums">{clock(d.readyAt)}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      {clock(d.pickedUpAt)}
                      {d.pickupMethod === 'MANUAL' && <span className="ml-1 text-xs text-amber-600">без скана</span>}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {d.status === 'DELIVERED' ? clock(d.deliveredAt) : (STATUS[d.status] ?? d.status)}
                    </td>
                    <td className="py-1 pr-3 tabular-nums text-neutral-600 dark:text-neutral-400">
                      {d.kitchen ?? '—'} / {d.wait ?? '—'} / {d.onWay ?? '—'}
                    </td>
                    <td
                      className={`py-1 tabular-nums ${
                        d.total !== null && d.total > 60 ? 'font-semibold text-red-600' : ''
                      }`}
                    >
                      {mins(d.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

function Stage({ label, sub, stat }: { label: string; sub: string; stat: Stat }) {
  return (
    <div className="rounded-lg bg-black/[.03] p-3 dark:bg-white/5">
      <div className="font-medium">{label}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{mins(stat.median)}</div>
      <div className="text-xs text-neutral-500">среднее {mins(stat.avg)} · заказов {stat.count}</div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: number; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-black/5 py-1 dark:border-white/10">
      <dt className="text-neutral-600 dark:text-neutral-400">{k}</dt>
      <dd className={`tabular-nums ${warn ? 'font-semibold text-amber-600' : ''}`}>{v}</dd>
    </div>
  );
}
