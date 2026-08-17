'use client';

import { useCallback, useEffect, useState } from 'react';
import { CashierOrder, CashierQueue, api, formatTenge } from '@/lib/api';

/**
 * Консоль кассира — нехватка позиции, первый этап (DECISIONS §12.9).
 *
 * Второе окно у кассира возвращается осознанно: телеграм убрали потому,
 * что она заходила туда на каждый заказ, а сюда зайдёт только когда
 * чего-то нет. Поэтому экран должен отвечать на один вопрос — «чего нет и
 * что с этим стало», — а не показывать дневную аналитику.
 *
 * Порядок работы: заказ в Poster НЕ принимать, отметить здесь позицию,
 * дождаться ответа клиента, принять уже исправленный чек.
 */

const PART_RU: Record<string, string> = {
  NEW: 'не принят',
  ACCEPTED: 'принят',
  REJECTED: 'отклонён',
};

export default function CashierPage() {
  const [data, setData] = useState<CashierQueue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<CashierQueue>('/admin/orders/queue'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    // Ответ клиента приходит в наш бэкенд, а не в это окно: без опроса
    // кассир смотрела бы на устаревший экран и звонила зря.
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Касса</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Если позиции нет — <b>не принимайте заказ в Poster</b>. Отметьте её
          здесь, дождитесь ответа клиента и примите уже исправленный чек. Через{' '}
          {data?.windowMinutes ?? 5} минут молчания везём остальное.
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-neutral-500">Загрузка…</p>}
      {data?.orders.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-neutral-500 dark:bg-neutral-900">
          Живых заказов нет
        </p>
      )}

      <ul className="space-y-3">
        {data?.orders.map((o) => (
          <OrderCard key={o.id} order={o} onDone={load} />
        ))}
      </ul>
    </div>
  );
}

function OrderCard({ order, onDone }: { order: CashierOrder; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = order.shortageState === 'AWAITING_CUSTOMER';
  const missing = order.items.filter((i) => i.isUnavailable);

  async function send(itemIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/orders/${order.id}/shortage`, { itemIds });
      setPicked([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900 ${
        waiting ? 'ring-2 ring-amber-400' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-semibold">№{order.number}</span>
        <span className="text-sm text-neutral-500">
          {new Date(order.createdAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="rounded-lg bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
          {order.type === 'DELIVERY' ? 'Доставка' : 'Самовывоз'}
        </span>
        <span className="text-sm">
          {order.customer?.name ?? 'Без имени'} · {order.customer?.phone}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {order.parts.map((p) => (
            <span
              key={p.department}
              className={`rounded-lg px-2 py-0.5 text-xs ${
                p.status === 'VOID'
                  ? 'bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-800'
                  : p.posterStatus === 'ACCEPTED'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : p.posterStatus === 'REJECTED' || p.status === 'FAILED'
                      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {p.department}: {PART_RU[p.posterStatus ?? ''] ?? 'отправлен'}
              {p.posterOrderId && p.posterOrderId !== 'dry-run' && ` · чек №${p.posterOrderId}`}
            </span>
          ))}
          <span className="font-semibold">{formatTenge(order.total)}</span>
        </span>
      </div>

      {order.comment && (
        <p className="mt-2 text-sm text-neutral-500">
          Пожелание клиента: {order.comment}
        </p>
      )}

      <ShortageBanner order={order} />

      {/* Отменённые чеки видны отдельной строкой: два чека на один заказ
          иначе выглядят как дубль, а один из них нужно отклонить. */}
      {order.parts.flatMap((p) =>
        p.replacedOrders?.map((r) => (
          <p
            key={`${p.department}-${r.posterOrderId}`}
            className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {p.department}: отклоните на планшете старый чек №{r.posterOrderId} —
            состав изменился
          </p>
        )),
      )}
      {order.parts
        .filter((p) => p.error)
        .map((p) => (
          <p
            key={`err-${p.department}`}
            className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {p.department}: {p.error}
          </p>
        ))}

      <ul className="mt-3 space-y-1">
        {order.items.map((i) => {
          const checked = picked.includes(i.id) || i.isUnavailable;
          // Подарок нельзя отметить: он не выбор клиента, а следствие
          // состава, и пересчитается сам вместе с позицией-условием.
          const locked = i.isGift || busy;
          return (
            <li key={i.id}>
              <label
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  locked ? 'opacity-60' : 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/10'
                } ${i.isUnavailable ? 'text-red-600 dark:text-red-400' : ''}`}
              >
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={checked}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked
                        ? [...prev, i.id]
                        : prev.filter((id) => id !== i.id),
                    )
                  }
                />
                <span className={i.isUnavailable ? 'line-through' : ''}>
                  {i.name} × {i.qty}
                </span>
                <span className="text-xs text-neutral-400">{i.department}</span>
                {i.isGift && <span className="text-xs text-emerald-600">подарок</span>}
                <span className="ml-auto text-neutral-500">
                  {/* У снятой позиции цены нет: она уже вычтена из суммы
                      заказа, и цифра рядом читалась бы как «всё равно
                      берём деньги». */}
                  {i.isUnavailable ? 'снято' : i.isGift ? '0 ₸' : formatTenge(i.price * i.qty)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => send([...missing.map((i) => i.id), ...picked])}
          disabled={busy || picked.length === 0}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? 'Отмечаем…' : 'Этих позиций нет'}
        </button>
        {missing.length > 0 && (
          <button
            onClick={() => send([])}
            disabled={busy}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/15"
          >
            Позиции нашлись
          </button>
        )}
      </div>
    </li>
  );
}

/** Что происходит с заказом прямо сейчас — крупно и словами кассира */
function ShortageBanner({ order }: { order: CashierOrder }) {
  const [left, setLeft] = useState<number>(0);

  useEffect(() => {
    if (order.shortageState !== 'AWAITING_CUSTOMER' || !order.shortageDeadline) {
      return;
    }
    const deadline = new Date(order.shortageDeadline).getTime();
    const tick = () => setLeft(Math.max(0, deadline - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [order.shortageState, order.shortageDeadline]);

  const missing = order.items.filter((i) => i.isUnavailable);
  if (order.shortageState === 'NONE') return null;

  const names = missing.map((i) => i.name).join(', ');

  if (order.shortageState === 'AWAITING_CUSTOMER') {
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    return (
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Ждём ответа клиента — {mm}:{String(ss).padStart(2, '0')}. Нет: {names}.
        Заказ в Poster пока не принимайте.
      </p>
    );
  }

  if (order.shortageState === 'KEPT_REST') {
    return (
      <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Везём без «{names}».{' '}
        {order.shortageResolvedBy === 'TIMEOUT'
          ? 'Клиент не ответил за отведённое время — позвоните ему.'
          : 'Клиент подтвердил.'}{' '}
        Готовьте исправленный чек.
      </p>
    );
  }

  return (
    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      Клиент отменил заказ целиком из-за «{names}». Отклоните чеки на планшетах.
    </p>
  );
}
