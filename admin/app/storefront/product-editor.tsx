'use client';

import { useState } from 'react';
import { AdminCategory, AdminProduct, api, formatTenge } from '@/lib/api';

export function ProductEditor({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: AdminProduct;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(product.displayName ?? '');
  const [displayDescription, setDisplayDescription] = useState(
    product.displayDescription ?? '',
  );
  const [priceOverride, setPriceOverride] = useState(
    product.priceOverride != null ? String(product.priceOverride) : '',
  );
  const [appCategoryId, setAppCategoryId] = useState(
    categories.find((c) => c.products.some((p) => p.id === product.id))?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const priceValid =
    priceOverride === '' ||
    (/^\d+$/.test(priceOverride) && Number(priceOverride) <= 10_000_000);

  async function save() {
    if (!priceValid) return;
    setBusy(true);
    try {
      await api.patch(`/admin/products/${product.id}`, {
        displayName,
        displayDescription,
        priceOverride: priceOverride === '' ? null : Number(priceOverride),
        appCategoryId,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-neutral-900 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start gap-3">
          {product.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.photoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
          )}
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{product.name}</h2>
            <p className="text-xs text-neutral-500">
              Из кассы: {formatTenge(product.price)} · {product.department} ·{' '}
              {product.posterCategory}
            </p>
          </div>
        </div>

        <Field label="Название в приложении" hint="Пусто — как в кассе">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            placeholder={product.name}
            className="input"
          />
        </Field>

        <Field label="Описание" hint="Показывается в карточке товара">
          <textarea
            value={displayDescription}
            onChange={(e) => setDisplayDescription(e.target.value)}
            maxLength={1000}
            placeholder={product.description || 'Например: тесто, пицца-соус, моцарелла…'}
            rows={3}
            className="input resize-y"
          />
        </Field>

        <Field
          label="Цена в приложении, ₸"
          hint={`Пусто — цена кассы (${formatTenge(product.price)})`}
        >
          <input
            type="number"
            min={0}
            max={10000000}
            step={1}
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
            placeholder={String(product.price)}
            className="input"
          />
        </Field>

        <Field label="Категория витрины">
          <select
            value={appCategoryId}
            onChange={(e) => setAppCategoryId(e.target.value)}
            className="input"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-5 flex gap-2">
          <button
            onClick={save}
            disabled={busy || !priceValid}
            className="flex-1 rounded-xl bg-black py-2.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-black/10 px-4 py-2.5 dark:border-white/15"
          >
            Отмена
          </button>
        </div>

        <style jsx>{`
          .input {
            width: 100%;
            border-radius: 0.75rem;
            border: 1px solid rgba(0, 0, 0, 0.1);
            background: transparent;
            padding: 0.5rem 0.75rem;
            outline: none;
          }
          :global(.dark) .input {
            border-color: rgba(255, 255, 255, 0.15);
          }
        `}</style>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}
