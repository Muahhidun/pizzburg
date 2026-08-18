'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminProduct,
  StopListResponse,
  StopPreset,
  Storefront,
  api,
  formatTenge,
} from '@/lib/api';

type Row = AdminProduct & { categoryName: string };

/**
 * Стоп-листы со сроком (DECISIONS §12.3).
 *
 * Срок обязателен, и это главное отличие от стопа в кассе: там позиция
 * ставится «на два часа» и висит до вечера, потому что вернуть её никто
 * не вспомнил. Здесь забыть невозможно — истёк срок, позиция вернулась
 * сама.
 *
 * Три раздела намеренно разделены. Наш стоп — временный, клиент видит
 * позицию неактивной. Скрытие с витрины — навсегда, клиент её не видит
 * вовсе. Стоп кассы Poster приходит синком, и вернуть его можно только
 * на планшете.
 */
export default function StopListPage() {
  const [stops, setStops] = useState<StopListResponse | null>(null);
  const [data, setData] = useState<Storefront | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [s, storefront] = await Promise.all([
      api.get<StopListResponse>('/admin/stoplist'),
      api.get<Storefront>('/admin/storefront'),
    ]);
    setStops(s);
    setData(storefront);
  }, []);

  useEffect(() => {
    load();
    // Срок мог истечь, пока страница открыта
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const all: Row[] = useMemo(
    () =>
      data?.categories.flatMap((c) =>
        c.products.map((p) => ({ ...p, categoryName: c.name })),
      ) ?? [],
    [data],
  );

  const stoppedIds = useMemo(
    () => new Set(stops?.products.map((p) => p.id) ?? []),
    [stops],
  );

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return all
      .filter(
        (p) =>
          !stoppedIds.has(p.id) &&
          (p.displayName ?? p.name).toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [all, search, stoppedIds]);

  const hiddenByMe = all.filter((p) => !p.isVisible);
  const stopByPoster = all.filter((p) => p.inStopList);

  async function syncPoster() {
    setSyncing(true);
    setError(null);
    try {
      await api.post('/admin/poster-sync');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Стоп-листы</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Позиция снимается <b>на срок</b> и возвращается сама. В приложении
            она остаётся видимой, но неактивной — исчезновение клиент читает как
            «блюда больше нет».
          </p>
        </div>
        <button
          onClick={syncPoster}
          disabled={syncing}
          className="rounded-lg border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15"
        >
          {syncing ? 'Синхронизируем…' : '↻ Синхронизировать с Poster'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">Снять с продажи</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Найдите позицию и укажите, на сколько её нет.
        </p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={120}
          placeholder="Название товара"
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
        />
        {found.length > 0 && stops && (
          <ul className="mt-2 space-y-2">
            {found.map((p) => (
              <StopForm
                key={p.id}
                title={p.displayName ?? p.name}
                subtitle={`${p.categoryName} · ${p.department} · ${formatTenge(p.priceOverride ?? p.price)}`}
                presets={stops.presets}
                onStop={async (preset, reason) => {
                  await api.post('/admin/stoplist', {
                    productId: p.id,
                    preset,
                    reason,
                  });
                  setSearch('');
                  await load();
                }}
              />
            ))}
          </ul>
        )}

        {data && stops && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-neutral-500">
              Снять целую категорию
            </summary>
            <ul className="mt-2 space-y-2">
              {data.categories
                .filter((c) => !stops.categories.some((s) => s.id === c.id))
                .map((c) => (
                  <StopForm
                    key={c.id}
                    title={c.name}
                    subtitle={`${c.productsTotal} позиций`}
                    presets={stops.presets}
                    onStop={async (preset, reason) => {
                      await api.post('/admin/stoplist', {
                        appCategoryId: c.id,
                        preset,
                        reason,
                      });
                      await load();
                    }}
                  />
                ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">
          Сейчас на стопе ·{' '}
          {(stops?.products.length ?? 0) + (stops?.categories.length ?? 0)}
        </h2>
        <p className="mb-3 text-sm text-neutral-500">
          Вернутся сами по истечении срока. Можно вернуть раньше.
        </p>
        {!stops?.products.length && !stops?.categories.length ? (
          <p className="text-sm text-neutral-400">Всё в продаже</p>
        ) : (
          <ul className="space-y-1">
            {stops.categories.map((c) => (
              <StoppedRow
                key={c.id}
                title={`Категория «${c.name}»`}
                subtitle={c.reason ?? ''}
                until={c.until}
                onRelease={async () => {
                  await api.post('/admin/stoplist/release', { appCategoryId: c.id });
                  await load();
                }}
              />
            ))}
            {stops.products.map((p) => (
              <StoppedRow
                key={p.id}
                title={p.name}
                subtitle={[p.category, p.department, p.reason]
                  .filter(Boolean)
                  .join(' · ')}
                until={p.until}
                onRelease={async () => {
                  await api.post('/admin/stoplist/release', { productId: p.id });
                  await load();
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">
          Стоп-лист кассы Poster · {stopByPoster.length}
        </h2>
        <p className="mb-3 text-sm text-neutral-500">
          Сняты на планшете — в приложении скрыты полностью. Вернуть можно
          только в Poster.
        </p>
        {stopByPoster.length === 0 ? (
          <p className="text-sm text-neutral-400">Касса ничего не блокирует</p>
        ) : (
          <ul className="space-y-1">
            {stopByPoster.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{p.displayName ?? p.name}</div>
                  <div className="text-xs text-neutral-400">
                    {p.categoryName} · {p.department}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                  стоп кассы
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">Убрано с витрины · {hiddenByMe.length}</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Это не стоп-лист, а решение убрать позицию из меню насовсем — клиент
          её не видит. Управляется на странице «Витрина».
        </p>
        {hiddenByMe.length === 0 ? (
          <p className="text-sm text-neutral-400">Ничего не убрано</p>
        ) : (
          <ul className="space-y-1">
            {hiddenByMe.map((p) => (
              <li key={p.id} className="rounded-xl bg-black/[.03] px-3 py-2 text-sm dark:bg-white/5">
                {p.displayName ?? p.name}
                <span className="ml-2 text-xs text-neutral-400">{p.categoryName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Строка «на сколько снимаем» — срок обязателен, поэтому он и есть кнопка */
function StopForm({
  title,
  subtitle,
  presets,
  onStop,
}: {
  title: string;
  subtitle: string;
  presets: { value: StopPreset; label: string }[];
  onStop: (preset: StopPreset, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop(preset: StopPreset) {
    setBusy(true);
    setError(null);
    try {
      await onStop(preset, reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-black/[.03] p-3 dark:bg-white/5">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-neutral-400">{subtitle}</div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="Причина (необязательно) — уйдёт в телеграм"
        className="mt-2 w-full rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm dark:border-white/15"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => stop(p.value)}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}

/** Позиция на стопе с обратным отсчётом до возврата */
function StoppedRow({
  title,
  subtitle,
  until,
  onRelease,
}: {
  title: string;
  subtitle: string;
  until: string;
  onRelease: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState('');

  useEffect(() => {
    const tick = () => {
      const ms = new Date(until).getTime() - Date.now();
      if (ms <= 0) return setLeft('возвращается');
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLeft(h > 0 ? `${h} ч ${m} мин` : `${m} мин`);
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [until]);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-neutral-500">{subtitle}</div>
      </div>
      <span className="shrink-0 text-xs text-amber-800 dark:text-amber-200">
        вернётся через {left} ·{' '}
        {new Date(until).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await onRelease();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-white/15"
      >
        {busy ? '…' : 'Вернуть сейчас'}
      </button>
    </li>
  );
}
