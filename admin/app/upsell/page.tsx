'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminCategory, Storefront, UpsellItem, api } from '@/lib/api';

/** Значение селекта для набора «к любому заказу» */
const ANY = '';

/**
 * Допродажи (DECISIONS §12.20).
 *
 * Наборы, а не один общий список: соус к пицце уместен, соус к десерту
 * — нет, и одно неуместное предложение обесценивает все остальные.
 * «К любому заказу» — отдельный набор, там живут напитки.
 */
export default function UpsellPage() {
  const [store, setStore] = useState<Storefront | null>(null);
  const [items, setItems] = useState<UpsellItem[] | null>(null);
  const [target, setTarget] = useState<string>(ANY);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const [s, u] = await Promise.all([
      api.get<Storefront>('/admin/storefront'),
      api.get<UpsellItem[]>('/admin/upsells'),
    ]);
    setStore(s);
    setItems(u);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  const products = useMemo(() => {
    if (!store) return [];
    return store.categories.flatMap((c) =>
      c.products.map((p) => ({
        id: p.id,
        name: p.displayName ?? p.name,
        price: p.priceOverride ?? p.price,
        category: c.name,
      })),
    );
  }, [store]);

  // Уже добавленные в выбранный набор не показываем в поиске: повторное
  // добавление ничего не сломает, но выглядит как будто не сработало.
  const alreadyHere = useMemo(
    () =>
      new Set(
        (items ?? [])
          .filter((i) => (i.appCategoryId ?? ANY) === target)
          .map((i) => i.productId),
      ),
    [items, target],
  );

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => !alreadyHere.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, query, alreadyHere]);

  const add = async (productId: string) => {
    try {
      await api.post('/admin/upsells', {
        productId,
        appCategoryId: target === ANY ? null : target,
      });
      setQuery('');
      await load();
      flash('Добавили');
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/admin/upsells/${id}`);
      await load();
      flash('Убрали');
    } catch (e) {
      flash((e as Error).message);
    }
  };

  if (!store || !items) return <p className="text-neutral-500">Загрузка…</p>;

  const groups: { key: string; title: string; hint: string }[] = [
    {
      key: ANY,
      title: 'К любому заказу',
      hint: 'Показываем всегда — здесь место напиткам',
    },
    ...store.categories.map((c: AdminCategory) => ({
      key: c.id,
      title: c.name,
      hint: `Показываем, если в корзине есть что-то из «${c.name}»`,
    })),
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Допродажи</h1>
        <p className="text-sm text-neutral-500">
          Что предложить добавить в корзине перед оформлением. Клиент видит
          не больше шести позиций.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-500">Добавить в набор</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setQuery('');
            }}
            className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          >
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.title}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти позицию…"
            className="min-w-48 flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          />
        </div>

        {query.trim().length >= 2 && (
          <div className="mt-3 space-y-1">
            {found.length === 0 && (
              <p className="text-sm text-neutral-500">Ничего не нашли</p>
            )}
            {found.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p.id)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span>
                  {p.name}{' '}
                  <span className="text-neutral-400">· {p.category}</span>
                </span>
                <span className="text-neutral-500">{p.price} ₸</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.map((g) => {
        const mine = items.filter((i) => (i.appCategoryId ?? ANY) === g.key);
        // Пустые категории не показываем: иначе список превращается в
        // перечисление всего меню, в котором нечего читать.
        if (mine.length === 0 && g.key !== ANY) return null;
        return (
          <div
            key={g.key}
            className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900"
          >
            <div className="text-sm font-semibold">{g.title}</div>
            <p className="text-xs text-neutral-500">{g.hint}</p>
            {mine.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">Пока пусто</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {mine.map((i) => (
                  <span
                    key={i.id}
                    className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-1.5 text-sm dark:bg-white/10"
                  >
                    {i.name}
                    <span className="text-neutral-500">{i.price} ₸</span>
                    <button
                      onClick={() => remove(i.id)}
                      aria-label={`Убрать ${i.name}`}
                      className="text-neutral-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-black">
          {toast}
        </div>
      )}
    </div>
  );
}
