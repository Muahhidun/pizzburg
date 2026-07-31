'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminProduct, Storefront, api, formatTenge } from '@/lib/api';

type Row = AdminProduct & { categoryName: string };

/**
 * Стоп-листы: что сейчас не продаётся. Два источника —
 * стоп-лист кассы Poster (управляется на планшете) и ручное скрытие
 * в приложении (управляется здесь).
 */
export default function StopListPage() {
  const [data, setData] = useState<Storefront | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setData(await api.get<Storefront>('/admin/storefront'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const all: Row[] = useMemo(
    () =>
      data?.categories.flatMap((c) =>
        c.products.map((p) => ({ ...p, categoryName: c.name })),
      ) ?? [],
    [data],
  );

  const hiddenByMe = all.filter((p) => !p.isVisible);
  const stopByPoster = all.filter((p) => p.inStopList && p.isVisible);
  const found = search.trim()
    ? all
        .filter((p) =>
          (p.displayName ?? p.name).toLowerCase().includes(search.trim().toLowerCase()),
        )
        .slice(0, 12)
    : [];

  async function toggle(p: Row) {
    await api.patch(`/admin/products/${p.id}`, { isVisible: !p.isVisible });
    load();
  }

  if (!data) return <p className="text-neutral-500">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Стоп-листы</h1>
        <p className="text-sm text-neutral-500">
          Что сейчас не продаётся в приложении.
        </p>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">Быстро убрать из продажи</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Найдите товар и выключите — он мгновенно исчезнет из приложения.
        </p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название товара"
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
        />
        {found.length > 0 && (
          <ul className="mt-2 space-y-1">
            {found.map((p) => (
              <ProductRow key={p.id} product={p} onToggle={() => toggle(p)} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">
          Выключено вручную · {hiddenByMe.length}
        </h2>
        <p className="mb-3 text-sm text-neutral-500">
          Скрыто в приложении вами. В кассе эти позиции продаются.
        </p>
        {hiddenByMe.length === 0 ? (
          <p className="text-sm text-neutral-400">Ничего не скрыто</p>
        ) : (
          <ul className="space-y-1">
            {hiddenByMe.map((p) => (
              <ProductRow key={p.id} product={p} onToggle={() => toggle(p)} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">
          Стоп-лист кассы Poster · {stopByPoster.length}
        </h2>
        <p className="mb-3 text-sm text-neutral-500">
          Сняты с продажи на планшете — в приложении скрыты автоматически. Вернуть
          можно только в Poster.
        </p>
        {stopByPoster.length === 0 ? (
          <p className="text-sm text-neutral-400">Касса ничего не блокирует</p>
        ) : (
          <ul className="space-y-1">
            {stopByPoster.map((p) => (
              <ProductRow key={p.id} product={p} readOnly />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProductRow({
  product: p,
  onToggle,
  readOnly,
}: {
  product: Row;
  onToggle?: () => void;
  readOnly?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{p.displayName ?? p.name}</div>
        <div className="text-xs text-neutral-400">
          {p.categoryName} · {p.department} · {formatTenge(p.priceOverride ?? p.price)}
        </div>
      </div>
      {readOnly ? (
        <span className="shrink-0 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          стоп-лист кассы
        </span>
      ) : (
        <button
          onClick={onToggle}
          className={`h-6 w-11 shrink-0 rounded-full transition ${
            p.isVisible ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white transition ${
              p.isVisible ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      )}
    </li>
  );
}
