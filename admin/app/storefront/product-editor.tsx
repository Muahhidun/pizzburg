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
  const [displayPhotoUrl, setDisplayPhotoUrl] = useState(product.displayPhotoUrl ?? '');
  const [weightLabel, setWeightLabel] = useState(product.weightLabel ?? '');
  const [isHit, setIsHit] = useState(product.isHit);
  const [isSpicy, setIsSpicy] = useState(product.isSpicy);
  const [isNew, setIsNew] = useState(product.isNew);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
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
  const photoValid =
    displayPhotoUrl.trim() === '' ||
    /^https?:\/\/[^\s]+$/i.test(displayPhotoUrl.trim());
  const formValid = priceValid && photoValid;

  async function uploadPhoto(file: File) {
    setPhotoError(null);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)) {
      setPhotoError('Выберите JPEG, PNG, WebP или HEIC');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError('Размер файла не должен превышать 10 МБ');
      return;
    }

    setPhotoUploading(true);
    try {
      const result = await api.upload<{ displayPhotoUrl: string }>(
        `/admin/products/${product.id}/photo`,
        file,
      );
      setDisplayPhotoUrl(result.displayPhotoUrl);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Не удалось загрузить фото');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function save() {
    if (!formValid) return;
    setBusy(true);
    try {
      await api.patch(`/admin/products/${product.id}`, {
        displayName,
        displayDescription,
        displayPhotoUrl: displayPhotoUrl.trim() || null,
        weightLabel,
        isHit,
        isSpicy,
        isNew,
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
          {(displayPhotoUrl || product.photoUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayPhotoUrl || product.photoUrl || ''}
              alt=""
              className="h-14 w-14 rounded-xl object-cover"
            />
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
          label="Собственное фото"
          hint="Фото уменьшится до 1600 px и сохранится в WebP. До 10 МБ"
        >
          <label className="mb-2 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-black/20 px-4 py-3 text-sm font-medium transition hover:bg-black/[.03] dark:border-white/20 dark:hover:bg-white/5">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              disabled={photoUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPhoto(file);
                e.target.value = '';
              }}
            />
            {photoUploading ? 'Загружаем и оптимизируем…' : 'Выбрать фотографию'}
          </label>
          {photoError && (
            <span className="mb-2 block text-xs text-red-600">{photoError}</span>
          )}
          <span className="mb-1 block text-xs text-neutral-400">
            Или вставьте готовую публичную ссылку
          </span>
          <input
            type="url"
            value={displayPhotoUrl}
            onChange={(e) => setDisplayPhotoUrl(e.target.value.slice(0, 2048))}
            placeholder={product.photoUrl ?? 'https://…/photo.jpg'}
            className={`input ${photoValid ? '' : '!border-red-500'}`}
          />
          {!photoValid && (
            <span className="mt-1 block text-xs text-red-600">
              Нужна полная ссылка, начинающаяся с http:// или https://
            </span>
          )}
        </Field>

        <Field label="Вес / размер" hint="Например: 30 см, 450 г или 8 шт.">
          <input
            value={weightLabel}
            onChange={(e) => setWeightLabel(e.target.value)}
            maxLength={40}
            placeholder="450 г"
            className="input"
          />
        </Field>

        <Field label="Метки товара">
          <div className="grid grid-cols-3 gap-2">
            <Flag checked={isHit} onChange={setIsHit} label="Хит" />
            <Flag checked={isSpicy} onChange={setIsSpicy} label="Острое" />
            <Flag checked={isNew} onChange={setIsNew} label="Новинка" />
          </div>
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
            disabled={busy || photoUploading || !formValid}
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

function Flag({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/15">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
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
