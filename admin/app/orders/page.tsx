'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminCancelReason,
  AdminOrder,
  OrdersResponse,
  api,
  formatTenge,
  todayLocal,
} from '@/lib/api';

const STATUS_RU: Record<string, string> = {
  NEW: 'Новый',
  ACCEPTED: 'Принят',
  COOKING: 'Готовится',
  READY: 'Готов',
  ON_WAY: 'В пути',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
};

const PAY_RU: Record<string, string> = {
  CASH: 'Наличные',
  CARD_ON_DELIVERY: 'Карта курьеру',
  KASPI_ONLINE: 'Kaspi онлайн',
};

const PART_RU: Record<string, string> = {
  NEW: 'новый',
  ACCEPTED: 'принят',
  REJECTED: 'отклонён',
};

/**
 * Что написать про часть заказа.
 *
 * `PENDING` — заказ ещё ждёт конца окна отмены и на планшет не уходил.
 * Раньше в этом случае писали «отправлен», и отменённый в окно заказ
 * выглядел так, будто чек лежит в кассе, хотя его там не было никогда.
 */
function partLabel(part: { status: string; posterStatus: string | null }) {
  if (part.status === 'PENDING') return 'ещё не отправлен';
  if (part.status === 'VOID') return 'погашена';
  if (part.status === 'FAILED') return 'ошибка отправки';
  return PART_RU[part.posterStatus ?? ''] ?? 'отправлен';
}

export default function OrdersPage() {
  const [date, setDate] = useState(todayLocal);
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api.get<OrdersResponse>(`/admin/orders?date=${date}`));
  }, [date]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // живая лента
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Заказы</h1>
          {data && (
            <p className="text-sm text-neutral-500">
              {data.total} заказов · выручка {formatTenge(data.revenue)}
            </p>
          )}
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
        />
      </div>

      {!data && <p className="text-neutral-500">Загрузка…</p>}
      {data?.orders.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-neutral-500 dark:bg-neutral-900">
          За этот день заказов нет
        </p>
      )}

      <ul className="space-y-2">
        {data?.orders.map((o) => (
          <li key={o.id} className="rounded-2xl bg-white shadow-sm dark:bg-neutral-900">
            <button
              onClick={() => setOpen(open === o.id ? null : o.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-4 text-left"
            >
              <span className="font-semibold">№{o.number}</span>
              <span className="text-sm text-neutral-500">
                {new Date(o.createdAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="rounded-lg bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                {o.type === 'DELIVERY' ? 'Доставка' : 'Самовывоз'}
              </span>
              <span className="text-sm">
                {o.customer?.name ?? 'Без имени'} · {o.customer?.phone}
              </span>
              {/* Сигнал о перезаказе: решает оператор, автоматики нет */}
              {o.otherActiveOrders?.length > 0 && (
                <span
                  title={`Другие живые заказы этого клиента: №${o.otherActiveOrders.join(', №')}`}
                  className="rounded-lg bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                >
                  ещё №{o.otherActiveOrders.join(', №')}
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {o.parts.map((p) => (
                  <span
                    key={p.department}
                    className={`rounded-lg px-2 py-0.5 text-xs ${
                      p.posterStatus === 'ACCEPTED'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : p.posterStatus === 'REJECTED' || p.status === 'FAILED'
                          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {p.department}: {partLabel(p)}
                  </span>
                ))}
                <span className="font-semibold">{formatTenge(o.total)}</span>
              </span>
            </button>

            {open === o.id && <OrderDetails order={o} onRefresh={load} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderDetails({ order, onRefresh }: { order: AdminOrder; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const addr = order.address as Record<string, string> | null;

  async function syncStatus() {
    setBusy(true);
    try {
      await api.post(`/orders/by-id/${order.id}/sync-status`);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-black/5 px-4 pb-4 pt-3 text-sm dark:border-white/10">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1.5 font-medium">Состав</h3>
          <ul className="space-y-1">
            {order.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-2">
                <span className={i.isGift ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                  {i.name} × {i.qty}
                  {i.isGift && ' — подарок по акции'}
                </span>
                <span className="shrink-0 text-neutral-500">
                  {i.isGift ? '0 ₸' : formatTenge(i.price * i.qty)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-0.5 border-t border-black/5 pt-2 text-neutral-500 dark:border-white/10">
            <div className="flex justify-between">
              <span>Товары</span>
              <span>{formatTenge(order.subtotal)}</span>
            </div>
            {order.deliveryFee > 0 && (
              <div className="flex justify-between">
                <span>Доставка</span>
                <span>{formatTenge(order.deliveryFee)}</span>
              </div>
            )}
            {order.discount - order.pointsSpent > 0 && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Выгода клиента по акции</span>
                <span>{formatTenge(order.discount - order.pointsSpent)}</span>
              </div>
            )}
            {order.pointsSpent > 0 && (
              <div className="flex justify-between text-sky-600 dark:text-sky-400">
                <span>Оплачено баллами</span>
                <span>−{formatTenge(order.pointsSpent)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-black dark:text-white">
              <span>К оплате</span>
              <span>{formatTenge(order.total)}</span>
            </div>
            {order.discount - order.pointsSpent > 0 && (
              <p className="pt-1 text-xs text-neutral-400">
                Подарок уходит в кассу полной ценой и закрывается «Личной
                интеграцией» — выручка смены сходится.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="font-medium">Детали</h3>
          <p className="text-neutral-500">Оплата: {PAY_RU[order.paymentMethod]}</p>
          <p className="text-neutral-500">Статус: {STATUS_RU[order.status] ?? order.status}</p>
          {order.pointsEarned > 0 && (
            <p className="text-emerald-600">Начислено: {order.pointsEarned} баллов</p>
          )}
          {order.scheduledAt && (
            <p className="text-neutral-500">
              Предзаказ на{' '}
              {new Date(order.scheduledAt).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
          {addr && (
            <p className="text-neutral-500">
              Адрес: {addr.street}, {addr.house}
              {addr.flat && `, кв. ${addr.flat}`}
              {addr.entrance && `, подъезд ${addr.entrance}`}
              {addr.floor && `, этаж ${addr.floor}`}
            </p>
          )}
          {order.comment && <p className="text-neutral-500">Комментарий: {order.comment}</p>}
          <div className="pt-1">
            {order.parts.map((p) => (
              <p key={p.department} className="text-neutral-500">
                {p.department}: чек №{p.posterOrderId ?? '—'} ·{' '}
                {partLabel(p)}
                {p.error && <span className="text-red-600"> · ошибка: {p.error}</span>}
              </p>
            ))}
          </div>
          <button
            onClick={syncStatus}
            disabled={busy}
            className="mt-1 rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
          >
            {busy ? 'Обновляем…' : '↻ Обновить статусы с планшетов'}
          </button>
          <StatusActions order={order} onRefresh={onRefresh} />
        </div>
      </div>
    </div>
  );
}

const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
  NEW: [
    { value: 'ACCEPTED', label: 'Принять' },
    { value: 'CANCELLED', label: 'Отменить' },
  ],
  ACCEPTED: [
    { value: 'COOKING', label: 'Готовится' },
    { value: 'READY', label: 'Готов' },
    { value: 'ON_WAY', label: 'В пути' },
    { value: 'DELIVERED', label: 'Доставлен' },
    { value: 'CANCELLED', label: 'Отменить' },
  ],
  COOKING: [
    { value: 'READY', label: 'Готов' },
    { value: 'ON_WAY', label: 'В пути' },
    { value: 'DELIVERED', label: 'Доставлен' },
    { value: 'CANCELLED', label: 'Отменить' },
  ],
  READY: [
    { value: 'ON_WAY', label: 'В пути' },
    { value: 'DELIVERED', label: 'Выдан / доставлен' },
    { value: 'CANCELLED', label: 'Отменить' },
  ],
  ON_WAY: [
    { value: 'DELIVERED', label: 'Доставлен' },
    { value: 'CANCELLED', label: 'Отменить' },
  ],
};

function StatusActions({ order, onRefresh }: { order: AdminOrder; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const options = NEXT_STATUS[order.status] ?? [];
  if (options.length === 0) return null;

  async function update(status: string) {
    // Отмена идёт не через смену статуса, а отдельным окном: без причины
    // из справочника отчёт по отменам не сгруппировать.
    if (status === 'CANCELLED') {
      setCancelling(true);
      return;
    }
    setBusy(status);
    try {
      await api.patch(`/admin/orders/${order.id}/status`, { status });
      onRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => update(option.value)}
            disabled={busy !== null}
            className={`rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 ${
              option.value === 'DELIVERED'
                ? 'bg-emerald-600 text-white'
                : option.value === 'CANCELLED'
                  ? 'border border-red-300 text-red-600'
                  : 'border border-black/10 dark:border-white/15'
            }`}
          >
            {busy === option.value ? 'Сохраняем…' : option.label}
          </button>
        ))}
      </div>
      {cancelling && (
        <CancelDialog
          order={order}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: AdminOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reasons, setReasons] = useState<AdminCancelReason[] | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminCancelReason[]>('/admin/cancel-reasons')
      // Оператору доступны все активные причины, включая внутренние
      .then((list) => setReasons(list.filter((r) => r.isActive)))
      .catch((e) => setError(e.message));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/orders/${order.id}/cancel`, {
        reasonId,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">Отмена заказа №{order.number}</h3>
        <p className="mt-1 text-sm text-neutral-500">
          {formatTenge(order.total)} · причина попадёт в отчёт по отменам
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {reasons === null ? (
            <p className="text-sm text-neutral-500">Загружаем причины…</p>
          ) : (
            reasons.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <input
                  type="radio"
                  name={`cancel-${order.id}`}
                  checked={reasonId === r.id}
                  onChange={() => setReasonId(r.id)}
                />
                <span>{r.label}</span>
                {!r.availableToCustomer && (
                  <span className="text-xs text-neutral-400">внутренняя</span>
                )}
              </label>
            ))
          )}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Комментарий (необязательно)"
          className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-800"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
          >
            Не отменять
          </button>
          <button
            onClick={submit}
            disabled={busy || !reasonId}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Отменяем…' : 'Отменить заказ'}
          </button>
        </div>
      </div>
    </div>
  );
}
