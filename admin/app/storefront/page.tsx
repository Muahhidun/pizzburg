'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AdminCategory,
  AdminProduct,
  Storefront,
  api,
  formatTenge,
} from '@/lib/api';
import { ProductEditor } from './product-editor';

export default function StorefrontPage() {
  const [data, setData] = useState<Storefront | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const d = await api.get<Storefront>('/admin/storefront');
    setData(d);
    setSelected((s) => s ?? d.categories[0]?.id ?? null);
  }, []);

  useEffect(() => {
    load().catch((e) => setToast(e.message));
  }, [load]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function onCategoryDragEnd(e: DragEndEvent) {
    if (!data || !e.over || e.active.id === e.over.id) return;
    const ids = data.categories.map((c) => c.id);
    const next = arrayMove(
      data.categories,
      ids.indexOf(String(e.active.id)),
      ids.indexOf(String(e.over.id)),
    );
    setData({ ...data, categories: next }); // optimistic
    await api.post('/admin/categories/reorder', { ids: next.map((c) => c.id) });
    setToast('Порядок сохранён');
  }

  async function onProductDragEnd(e: DragEndEvent) {
    if (!data || !e.over || e.active.id === e.over.id) return;
    const cat = data.categories.find((c) => c.id === selected);
    if (!cat) return;
    const ids = cat.products.map((p) => p.id);
    const next = arrayMove(
      cat.products,
      ids.indexOf(String(e.active.id)),
      ids.indexOf(String(e.over.id)),
    );
    setData({
      ...data,
      categories: data.categories.map((c) =>
        c.id === cat.id ? { ...c, products: next } : c,
      ),
    });
    await api.post('/admin/products/reorder', { ids: next.map((p) => p.id) });
    setToast('Порядок товаров сохранён');
  }

  async function toggleCategory(c: AdminCategory) {
    await api.patch(`/admin/categories/${c.id}`, { isVisible: !c.isVisible });
    load();
  }

  async function renameCategory(c: AdminCategory) {
    const name = prompt('Название категории в приложении:', c.name);
    if (!name || name === c.name) return;
    await api.patch(`/admin/categories/${c.id}`, { name });
    load();
  }

  async function toggleProduct(p: AdminProduct) {
    await api.patch(`/admin/products/${p.id}`, { isVisible: !p.isVisible });
    load();
  }

  async function runSync() {
    if (!data) return;
    setSyncing(true);
    try {
      const res = await api.post<Record<string, { categories: number; products: number }>>(
        `/poster/sync/${data.tenantId}`,
      );
      setToast(
        Object.entries(res)
          .map(([dep, r]) => `${dep}: ${r.products} товаров`)
          .join(' · '),
      );
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  if (!data) return <p className="text-neutral-500">Загрузка…</p>;
  const current = data.categories.find((c) => c.id === selected);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Витрина</h1>
          <p className="text-sm text-neutral-500">
            Меню приложения. Цены и стоп-листы приходят из Poster, всё остальное
            настраивается здесь.
          </p>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
        >
          {syncing ? 'Синхронизация…' : '↻ Синхронизировать с Poster'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        {/* Категории */}
        <section className="rounded-2xl bg-white p-3 shadow-sm dark:bg-neutral-900">
          <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-500">
            Категории — перетащите, чтобы изменить порядок
          </h2>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onCategoryDragEnd}
          >
            <SortableContext
              items={data.categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1">
                {data.categories.map((c) => (
                  <SortableRow key={c.id} id={c.id}>
                    <button
                      onClick={() => setSelected(c.id)}
                      className={`flex-1 truncate text-left text-sm ${
                        selected === c.id ? 'font-semibold' : ''
                      } ${c.isVisible ? '' : 'text-neutral-400 line-through'}`}
                    >
                      {c.name}
                      <span className="ml-1.5 text-xs text-neutral-400">
                        {c.productsVisible}
                      </span>
                    </button>
                    <button
                      title="Переименовать"
                      onClick={() => renameCategory(c)}
                      className="rounded px-1 text-xs text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                    >
                      ✎
                    </button>
                    <button
                      title={c.isVisible ? 'Скрыть' : 'Показать'}
                      onClick={() => toggleCategory(c)}
                      className={`h-5 w-9 shrink-0 rounded-full transition ${
                        c.isVisible ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          c.isVisible ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </SortableRow>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        {/* Товары */}
        <section className="rounded-2xl bg-white p-3 shadow-sm dark:bg-neutral-900">
          {current && (
            <>
              <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-500">
                {current.name} — {current.productsVisible} из {current.productsTotal} в
                приложении
              </h2>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onProductDragEnd}
              >
                <SortableContext
                  items={current.products.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-1">
                    {current.products.map((p) => (
                      <SortableRow key={p.id} id={p.id}>
                        {p.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.photoUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-sm ${
                                p.isVisible ? '' : 'text-neutral-400 line-through'
                              }`}
                            >
                              {p.displayName ?? p.name}
                            </span>
                            {p.hasModifiers && (
                              <span className="shrink-0 rounded bg-blue-50 px-1 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                выбор
                              </span>
                            )}
                            {p.inStopList && (
                              <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                                стоп-лист
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-neutral-400">
                            {formatTenge(p.priceOverride ?? p.price)}
                            {p.priceOverride != null && (
                              <span className="ml-1 line-through">
                                {formatTenge(p.price)}
                              </span>
                            )}
                            <span className="ml-1.5">· {p.department}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setEditing(p)}
                          className="rounded px-1.5 text-xs text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => toggleProduct(p)}
                          className={`h-5 w-9 shrink-0 rounded-full transition ${
                            p.isVisible
                              ? 'bg-emerald-500'
                              : 'bg-neutral-300 dark:bg-neutral-700'
                          }`}
                        >
                          <span
                            className={`block h-4 w-4 rounded-full bg-white transition ${
                              p.isVisible ? 'translate-x-4.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </SortableRow>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
        </section>
      </div>

      {editing && (
        <ProductEditor
          product={editing}
          categories={data.categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            setToast('Сохранено');
          }}
        />
      )}

      {toast && (
        <div
          onClick={() => setToast('')}
          className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 cursor-pointer rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-black"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
        isDragging ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/[.03] dark:hover:bg-white/5'
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none px-0.5 text-neutral-300 active:cursor-grabbing"
      >
        ⠿
      </span>
      {children}
    </li>
  );
}
