'use client';

import { useCallback, useEffect, useState } from 'react';
import { Promotion, Storefront, api } from '@/lib/api';

export default function PromotionsPage() {
  const [promos, setPromos] = useState<Promotion[] | null>(null);
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      api.get<Promotion[]>('/admin/promotions'),
      api.get<Storefront>('/admin/storefront'),
    ]);
    setPromos(p);
    setStorefront(s);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(p: Promotion) {
    await api.patch(`/admin/promotions/${p.id}`, { isActive: !p.isActive });
    load();
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Акции</h1>
          <p className="text-sm text-neutral-500">
            Подарок появляется в корзине сам. В кассу уходит полной ценой и
            закрывается «Личной интеграцией» — смена сходится.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          + Новая акция
        </button>
      </div>

      <ul className="space-y-2">
        {promos?.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                {p.code ? (
                  <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">
                    {p.code}
                  </span>
                ) : (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    автоматически
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-500">
                {p.conditionQty} × «{p.conditionCategoryName}» → «{p.giftProductName}»
                {p.giftQty > 1 && ` ×${p.giftQty}`}
                {p.repeatPerCart && ' · повторяется в чеке'}
              </p>
            </div>
            <button
              onClick={() => toggle(p)}
              className={`h-6 w-11 shrink-0 rounded-full transition ${
                p.isActive ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white transition ${
                  p.isActive ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      {creating && storefront && (
        <PromoForm
          storefront={storefront}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function PromoForm({
  storefront,
  onClose,
  onSaved,
}: {
  storefront: Storefront;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [conditionCategoryId, setConditionCategoryId] = useState(
    storefront.categories[0]?.id ?? '',
  );
  const [conditionQty, setConditionQty] = useState('2');
  const [giftProductId, setGiftProductId] = useState('');
  const [giftQty, setGiftQty] = useState('1');
  const [code, setCode] = useState('');
  const [repeatPerCart, setRepeatPerCart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const allProducts = storefront.categories.flatMap((c) =>
    c.products.map((p) => ({ ...p, categoryName: c.name })),
  );
  const found = search
    ? allProducts
        .filter((p) =>
          (p.displayName ?? p.name).toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const gift = allProducts.find((p) => p.id === giftProductId);

  async function save() {
    setBusy(true);
    try {
      await api.post('/admin/promotions', {
        name,
        code: code || null,
        conditionCategoryId,
        conditionQty: Number(conditionQty),
        giftProductId,
        giftQty: Number(giftQty),
        repeatPerCart,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-neutral-900 sm:rounded-2xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Новая акция</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Название</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2+1 Пицца"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
        </label>

        <div className="mb-3 grid grid-cols-[1fr_90px] gap-2">
          <label>
            <span className="mb-1 block text-sm font-medium">Условие: категория</span>
            <select
              value={conditionCategoryId}
              onChange={(e) => setConditionCategoryId(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            >
              {storefront.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Штук</span>
            <input
              type="number"
              min={1}
              value={conditionQty}
              onChange={(e) => setConditionQty(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Подарок</span>
          {gift ? (
            <div className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/15">
              <span className="flex-1 truncate text-sm">
                {gift.displayName ?? gift.name}
              </span>
              <button
                onClick={() => {
                  setGiftProductId('');
                  setSearch('');
                }}
                className="text-xs text-neutral-400"
              >
                изменить
              </button>
            </div>
          ) : (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Начните вводить название товара"
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
              />
              {found.length > 0 && (
                <ul className="mt-1 overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                  {found.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => setGiftProductId(p.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <span className="truncate">{p.displayName ?? p.name}</span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {p.categoryName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label>
            <span className="mb-1 block text-sm font-medium">Подарков, шт</span>
            <input
              type="number"
              min={1}
              value={giftQty}
              onChange={(e) => setGiftQty(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Промокод</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="пусто = авто"
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={repeatPerCart}
            onChange={(e) => setRepeatPerCart(e.target.checked)}
          />
          Повторять в рамках одного заказа (4 пиццы → 2 подарка)
        </label>

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || !name || !giftProductId}
            className="flex-1 rounded-xl bg-black py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? 'Создаём…' : 'Создать'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-black/10 px-4 py-2.5 dark:border-white/15"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
