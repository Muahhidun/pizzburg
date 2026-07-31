'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatTenge, todayLocal } from '@/lib/api';

interface Dashboard {
  date: string;
  orders: number;
  revenue: number;
  averageCheck: number;
  cancelled: number;
  comparison: { orders: number; revenue: number };
  byType: { delivery: number; pickup: number };
  byPayment: { cash: number; card: number; online: number };
  byHour: { hour: number; orders: number; revenue: number }[];
  topProducts: { name: string; qty: number; sum: number }[];
}

export default function DashboardPage() {
  const [date, setDate] = useState(todayLocal);
  const [d, setD] = useState<Dashboard | null>(null);

  const load = useCallback(async () => {
    setD(await api.get<Dashboard>(`/admin/dashboard?date=${date}`));
  }, [date]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!d) return <p className="text-neutral-500">Загрузка…</p>;

  const diff = (now: number, prev: number) =>
    prev === 0 ? null : Math.round(((now - prev) / prev) * 100);
  const revenueDiff = diff(d.revenue, d.comparison.revenue);
  const maxHour = Math.max(...d.byHour.map((h) => h.revenue), 1);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Сводка</h1>
          <p className="text-sm text-neutral-500">Показатели дня, обновляется автоматически</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Выручка"
          value={formatTenge(d.revenue)}
          hint={
            revenueDiff !== null
              ? `${revenueDiff >= 0 ? '+' : ''}${revenueDiff}% ко вчера`
              : 'вчера заказов не было'
          }
          positive={revenueDiff === null ? undefined : revenueDiff >= 0}
        />
        <Stat label="Заказов" value={String(d.orders)} hint={`вчера ${d.comparison.orders}`} />
        <Stat label="Средний чек" value={formatTenge(d.averageCheck)} />
        <Stat
          label="Доставка / самовывоз"
          value={`${d.byType.delivery} / ${d.byType.pickup}`}
          hint={d.cancelled > 0 ? `отменено: ${d.cancelled}` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
          <h2 className="mb-4 font-semibold">Выручка по часам</h2>
          <div className="flex h-40 items-end gap-1">
            {d.byHour.map((h) => (
              <div key={h.hour} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-emerald-500/80 transition group-hover:bg-emerald-500"
                  style={{ height: `${(h.revenue / maxHour) * 150}px`, minHeight: h.revenue ? 3 : 0 }}
                />
                {h.revenue > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-2 py-1 text-xs text-white group-hover:block dark:bg-white dark:text-black">
                    {h.hour}:00 — {h.orders} зак. · {formatTenge(h.revenue)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
            {[0, 6, 12, 18, 23].map((h) => (
              <span key={h}>{h}:00</span>
            ))}
          </div>

          <h2 className="mb-2 mt-6 font-semibold">Способы оплаты</h2>
          <div className="flex gap-2 text-sm">
            <Pill label="Наличные" value={d.byPayment.cash} />
            <Pill label="Карта курьеру" value={d.byPayment.card} />
            <Pill label="Kaspi онлайн" value={d.byPayment.online} />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
          <h2 className="mb-3 font-semibold">Топ товаров</h2>
          {d.topProducts.length === 0 && (
            <p className="text-sm text-neutral-500">Заказов пока нет</p>
          )}
          <ol className="space-y-2">
            {d.topProducts.map((p, i) => (
              <li key={p.name} className="flex items-baseline gap-2 text-sm">
                <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 font-medium">{p.qty} шт</span>
                <span className="shrink-0 text-neutral-400">{formatTenge(p.sum)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  positive,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
      {hint && (
        <div
          className={`mt-0.5 text-xs ${
            positive === undefined
              ? 'text-neutral-400'
              : positive
                ? 'text-emerald-600'
                : 'text-red-500'
          }`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-xl bg-black/5 px-3 py-1.5 dark:bg-white/10">
      {label}: <b>{value}</b>
    </span>
  );
}
