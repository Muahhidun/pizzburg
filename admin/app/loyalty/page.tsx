'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  formatTenge,
  LoyaltyLevel,
  LoyaltyLevelsResponse,
} from '@/lib/api';

type Draft = { name: string; cashbackPct: string; minSpent: string };

const toDraft = (l: LoyaltyLevel): Draft => ({
  name: l.name,
  cashbackPct: String(l.cashbackPct),
  minSpent: String(l.minSpent),
});

/**
 * Уровни кэшбэка.
 *
 * Порог — оборот выполненных заказов за всё время; уровень никогда не
 * понижается. Первая ступень обязана начинаться с 0 ₸, иначе новый клиент
 * останется без уровня, а ступени не могут идти вниз по проценту: «трачу
 * больше — получаю меньше» читается как обман.
 *
 * Номера ступеней здесь не редактируются: сервер проставляет их заново по
 * возрастанию порога, потому что `loyaltyLevel` у клиента — это номер в
 * лестнице.
 */
export default function LoyaltyPage() {
  const [data, setData] = useState<LoyaltyLevelsResponse | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<LoyaltyLevelsResponse>(
      '/admin/settings/loyalty-levels',
    );
    setData(res);
    setRows(res.levels.map(toDraft));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  function patch(i: number, field: keyof Draft, value: string) {
    setSaved(false);
    setRows((prev) =>
      prev.map((r, j) => (i === j ? { ...r, [field]: value } : r)),
    );
  }

  function addRow() {
    setSaved(false);
    const last = rows[rows.length - 1];
    setRows([
      ...rows,
      {
        name: '',
        // Предзаполняем следующим разумным шагом, а не нулями: пустая форма
        // заставляет владельца заново придумывать всю лестницу.
        cashbackPct: last ? String(Number(last.cashbackPct) + 1) : '3',
        minSpent: last ? String(Number(last.minSpent) + 50_000) : '0',
      },
    ]);
  }

  function removeRow(i: number) {
    setSaved(false);
    setRows(rows.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/admin/settings/loyalty-levels', {
        levels: rows.map((r) => ({
          name: r.name.trim(),
          cashbackPct: Number(r.cashbackPct),
          minSpent: Number(r.minSpent),
        })),
      });
      await load();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const resetToDefaults = () => {
    if (!data) return;
    setSaved(false);
    setRows(data.defaults.map(toDraft));
  };

  const input =
    'w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-800';

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold">Уровни кэшбэка</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-500">
        Порог — сумма выполненных заказов клиента за всё время. Уровень не
        понижается: достигнутый процент остаётся у клиента навсегда.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950">
          Сохранено. Новый процент применится при следующем начислении.
        </p>
      )}

      {data?.flatCashbackPct != null && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          В настройках задан единый кэшбэк {data.flatCashbackPct}% для всех — он
          перекрывает лестницу, и уровни ниже сейчас не работают. Сохранение на
          этой странице уберёт единый процент и включит уровни.
        </p>
      )}

      {data === null ? (
        <p className="mt-6 text-sm text-neutral-500">Загружаем…</p>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid items-end gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/15 sm:grid-cols-[1fr_120px_160px_auto]"
              >
                <label className="text-sm">
                  <span className="mb-1 block text-neutral-500">Название</span>
                  <input
                    value={row.name}
                    onChange={(e) => patch(i, 'name', e.target.value)}
                    placeholder="Постоянный"
                    className={input}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-neutral-500">Кэшбэк, %</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={row.cashbackPct}
                    onChange={(e) => patch(i, 'cashbackPct', e.target.value)}
                    className={input}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-neutral-500">
                    Оборот от, ₸
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={row.minSpent}
                    onChange={(e) => patch(i, 'minSpent', e.target.value)}
                    className={input}
                  />
                </label>
                <button
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={addRow}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              Добавить уровень
            </button>
            <button
              onClick={resetToDefaults}
              className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Вернуть стандартные
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="ml-auto rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Что увидит клиент</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-black/5 px-4 py-3 text-sm last:border-0 dark:border-white/10"
                >
                  <span className="font-medium">
                    {row.name.trim() || `Уровень ${i + 1}`}
                  </span>
                  <span className="text-neutral-500">
                    {row.cashbackPct || 0}% ·{' '}
                    {Number(row.minSpent) === 0
                      ? 'с первого заказа'
                      : `от ${formatTenge(Number(row.minSpent) || 0)}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
