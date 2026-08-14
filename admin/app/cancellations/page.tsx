'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminCancelReason, api, formatTenge, todayLocal } from '@/lib/api';

type Report = {
  from: string;
  to: string;
  total: number;
  lostAmount: number;
  byReason: { label: string; count: number; amount: number }[];
  byWho: Record<string, number>;
};

const WHO_RU: Record<string, string> = {
  CUSTOMER: 'Клиент',
  ADMIN: 'Оператор',
  POSTER: 'Касса',
  UNKNOWN: 'Не указан',
};

/** Первое число текущего месяца — разумное начало периода по умолчанию */
function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Отмены: справочник причин и отчёт по ним.
 *
 * Справочник и отчёт живут на одной странице намеренно: причины заводят
 * ради разбивки в отчёте, и видеть результат нужно там же, где правишь
 * список.
 */
export default function CancellationsPage() {
  const [reasons, setReasons] = useState<AdminCancelReason[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const [newLabel, setNewLabel] = useState('');
  const [newForCustomer, setNewForCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadReasons = useCallback(async () => {
    setReasons(await api.get<AdminCancelReason[]>('/admin/cancel-reasons'));
  }, []);

  const loadReport = useCallback(async () => {
    setReport(
      await api.get<Report>(
        `/admin/reports/cancellations?from=${from}&to=${to}`,
      ),
    );
  }, [from, to]);

  useEffect(() => {
    loadReasons();
  }, [loadReasons]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await loadReasons();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      await api.post('/admin/cancel-reasons', {
        label: newLabel.trim(),
        availableToCustomer: newForCustomer,
      });
      setNewLabel('');
      setNewForCustomer(false);
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    run(() => api.patch(`/admin/cancel-reasons/${id}`, body));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Отмены</h1>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">
          {error}
        </p>
      )}

      <section className="mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="text-lg font-semibold">Отчёт</h2>
          <label className="text-sm">
            <span className="mr-2 text-neutral-500">с</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-neutral-800"
            />
          </label>
          <label className="text-sm">
            <span className="mr-2 text-neutral-500">по</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-neutral-800"
            />
          </label>
        </div>

        {report === null ? (
          <p className="mt-3 text-sm text-neutral-500">Загружаем…</p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
                <p className="text-sm text-neutral-500">Отменённых заказов</p>
                <p className="text-2xl font-bold">{report.total}</p>
              </div>
              <div className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
                <p className="text-sm text-neutral-500">Потерянная выручка</p>
                <p className="text-2xl font-bold">
                  {formatTenge(report.lostAmount)}
                </p>
              </div>
            </div>

            {report.total === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">
                За этот период отмен не было.
              </p>
            ) : (
              <>
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-neutral-500">
                    <tr>
                      <th className="py-2">Причина</th>
                      <th className="py-2 text-right">Отмен</th>
                      <th className="py-2 text-right">Потеряно</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byReason.map((r) => (
                      <tr
                        key={r.label}
                        className="border-t border-black/5 dark:border-white/10"
                      >
                        <td className="py-2">{r.label}</td>
                        <td className="py-2 text-right">{r.count}</td>
                        <td className="py-2 text-right">
                          {formatTenge(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(report.byWho).map(([who, count]) => (
                    <span
                      key={who}
                      className="rounded-lg bg-black/5 px-3 py-1 text-sm dark:bg-white/10"
                    >
                      {WHO_RU[who] ?? who}: {count}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Справочник причин</h2>
        <p className="mt-1 text-sm text-neutral-500">
          «Доступна клиенту» — причина появляется в приложении. Служебные
          причины вроде «нет курьеров» клиент выбирать не должен.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Новая причина"
            maxLength={100}
            className="min-w-56 flex-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15 dark:bg-neutral-800"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={newForCustomer}
              onChange={(e) => setNewForCustomer(e.target.checked)}
            />
            доступна клиенту
          </label>
          <button
            onClick={create}
            disabled={busy || newLabel.trim().length < 2}
            className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Добавить
          </button>
        </div>

        <div className="mt-4 space-y-1">
          {reasons === null ? (
            <p className="text-sm text-neutral-500">Загружаем…</p>
          ) : (
            reasons.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-black/10 px-3 py-2 dark:border-white/15"
              >
                <span
                  className={`flex-1 text-sm ${r.isActive ? '' : 'text-neutral-400 line-through'}`}
                >
                  {r.label}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={r.availableToCustomer}
                    disabled={busy}
                    onChange={(e) =>
                      patch(r.id, { availableToCustomer: e.target.checked })
                    }
                  />
                  клиенту
                </label>
                <button
                  onClick={() => patch(r.id, { isActive: !r.isActive })}
                  disabled={busy}
                  className="rounded-lg border border-black/10 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-white/15"
                >
                  {r.isActive ? 'Выключить' : 'Включить'}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
