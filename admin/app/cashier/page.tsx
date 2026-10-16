'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AvailabilityNow,
  AdminCancelReason,
  CashierOrder,
  CashierQueue,
  StopListResponse,
  StopPreset,
  Storefront,
  WoltDriveDelivery,
  WoltDriveState,
  api,
  formatTenge,
} from '@/lib/api';

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
          Всё для смены на одном экране: приём заказов, стоп-листы и заказы,
          которым нужно внимание. При нехватке <b>не принимайте заказ в Poster</b>.
          Через{' '}
          {data?.windowMinutes ?? 5} минут молчания везём остальное.
        </p>
      </div>

      <CashierTools />

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

function CashierTools() {
  const [state, setState] = useState<AvailabilityNow | null>(null);
  const [stops, setStops] = useState<StopListResponse | null>(null);
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [search, setSearch] = useState('');
  const [duration, setDuration] = useState<30 | 60 | 120>(60);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [nextState, nextStops, nextStorefront] = await Promise.all([
      api.get<AvailabilityNow>('/admin/cashier/state'),
      api.get<StopListResponse>('/admin/stoplist'),
      api.get<Storefront>('/admin/storefront'),
    ]);
    setState(nextState); setStops(nextStops); setStorefront(nextStorefront); setError('');
  }, []);
  useEffect(() => { load().catch((e) => setError((e as Error).message)); const t = setInterval(() => load().catch(() => undefined), 30000); return () => clearInterval(t); }, [load]);

  const stoppedIds = useMemo(() => new Set(stops?.products.map((p) => p.id) ?? []), [stops]);
  const found = useMemo(() => {
    const q = search.trim().toLowerCase(); if (q.length < 2) return [];
    return (storefront?.categories.flatMap((category) => category.products.map((product) => ({ product, category: category.name }))) ?? [])
      .filter(({ product }) => !stoppedIds.has(product.id) && (product.displayName ?? product.name).toLowerCase().includes(q)).slice(0, 6);
  }, [search, storefront, stoppedIds]);

  async function changeOrdering(mode: 'ALL' | 'PICKUP_ONLY' | 'CLOSED') {
    setBusy(`ordering-${mode}`); setError('');
    try { await api.patch('/admin/cashier/ordering', { mode, durationMinutes: mode === 'ALL' ? undefined : duration, reason }); setReason(''); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function stop(payload: { productId?: string; appCategoryId?: string }, preset: StopPreset) {
    setBusy(`stop-${payload.productId ?? payload.appCategoryId}`); setError('');
    try { await api.post('/admin/stoplist', { ...payload, preset, reason }); setSearch(''); setReason(''); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  return <div className="mb-5 grid gap-3 lg:grid-cols-2">
    {error && <p className="text-sm text-red-600 lg:col-span-2">{error}</p>}
    <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Приём заказов</h2><p className="text-xs text-neutral-500">Ограничение снимется само.</p></div><span className={`rounded-lg px-2 py-1 text-xs font-medium ${state?.mode === 'ALL' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{state?.mode === 'ALL' ? 'работаем' : state?.mode === 'PICKUP_ONLY' ? 'только самовывоз' : 'закрыто'}</span></div>
      {state?.orderingUntil && <p className="mt-2 text-xs text-amber-700">До {new Date(state.orderingUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>}
      <div className="mt-3 flex gap-2">{([30, 60, 120] as const).map((m) => <button key={m} onClick={() => setDuration(m)} className={`rounded-lg px-3 py-1.5 text-xs ${duration === m ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 dark:border-white/15'}`}>{m < 60 ? '30 мин' : `${m / 60} ч`}</button>)}</div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Причина — уйдёт администраторам" className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
      <div className="mt-3 flex flex-wrap gap-2"><button disabled={!!busy} onClick={() => changeOrdering('PICKUP_ONLY')} className="rounded-lg bg-amber-600 px-3 py-2 text-xs text-white">Остановить доставку</button><button disabled={!!busy} onClick={() => changeOrdering('CLOSED')} className="rounded-lg bg-red-600 px-3 py-2 text-xs text-white">Остановить все заказы</button>{state?.mode !== 'ALL' && <button disabled={!!busy} onClick={() => changeOrdering('ALL')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white">Возобновить</button>}</div>
      <div className="mt-4 border-t border-black/5 pt-3 dark:border-white/10"><div className="text-xs font-medium">Высокий спрос</div><div className="mt-2 flex flex-wrap gap-2">{[20, 40, 60].map((m) => <button key={m} disabled={!!busy} onClick={async () => { setBusy('rush'); try { await api.patch('/admin/settings/rush', { extraMinutes: m }); await load(); } finally { setBusy(''); } }} className={`rounded-lg px-3 py-1.5 text-xs ${state?.rushExtraMinutes === m ? 'bg-amber-600 text-white' : 'border border-black/10 dark:border-white/15'}`}>+{m} мин</button>)}{Boolean(state?.rushExtraMinutes) && <button onClick={async () => { await api.patch('/admin/settings/rush', { extraMinutes: 0 }); await load(); }} className="text-xs text-neutral-500">снять</button>}</div></div>
    </section>

    <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
      <h2 className="font-semibold">Стоп-лист</h2><p className="text-xs text-neutral-500">Товар или категория вернутся в меню сами.</p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти товар" className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
      <ul className="mt-2 space-y-2">{found.map(({ product, category }) => <li key={product.id} className="rounded-lg bg-black/[.03] p-2 text-sm dark:bg-white/5"><div>{product.displayName ?? product.name}<span className="ml-2 text-xs text-neutral-400">{category} · {product.department}</span></div><div className="mt-2 flex flex-wrap gap-1">{stops?.presets.map((preset) => <button key={preset.value} disabled={!!busy} onClick={() => stop({ productId: product.id }, preset.value)} className="rounded bg-red-600 px-2 py-1 text-[11px] text-white">{preset.label}</button>)}</div></li>)}</ul>
      <details className="mt-3"><summary className="cursor-pointer text-xs text-neutral-500">Остановить целую категорию</summary><ul className="mt-2 max-h-56 space-y-1 overflow-auto">{storefront?.categories.filter((category) => !stops?.categories.some((item) => item.id === category.id)).map((category) => <li key={category.id} className="flex flex-wrap items-center gap-1 rounded-lg bg-black/[.03] p-2 text-xs dark:bg-white/5"><span className="mr-auto font-medium">{category.name}</span>{stops?.presets.map((preset) => <button key={preset.value} disabled={!!busy} onClick={() => stop({ appCategoryId: category.id }, preset.value)} className="rounded border border-black/10 px-2 py-1 dark:border-white/15">{preset.label}</button>)}</li>)}</ul></details>
      <div className="mt-4 border-t border-black/5 pt-3 dark:border-white/10"><div className="mb-2 text-xs font-medium">Сейчас на стопе · {(stops?.products.length ?? 0) + (stops?.categories.length ?? 0)}</div><ul className="max-h-40 space-y-1 overflow-auto">{stops?.categories.map((item) => <StopRow key={item.id} name={`Категория: ${item.name}`} until={item.until} release={() => api.post('/admin/stoplist/release', { appCategoryId: item.id }).then(load)} />)}{stops?.products.map((item) => <StopRow key={item.id} name={item.name} until={item.until} release={() => api.post('/admin/stoplist/release', { productId: item.id }).then(load)} />)}</ul></div>
    </section>
  </div>;
}

function StopRow({ name, until, release }: { name: string; until: string; release: () => Promise<unknown> }) {
  return <li className="flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs dark:bg-amber-950/40"><span className="min-w-0 flex-1 truncate">{name}</span><span className="text-neutral-500">до {new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span><button onClick={() => release()} className="font-medium text-emerald-700">вернуть</button></li>;
}

function OrderCard({ order, onDone }: { order: CashierOrder; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [woltOpen, setWoltOpen] = useState(false);

  const waiting = order.shortageState === 'AWAITING_CUSTOMER';
  const cancelled = order.status === 'CANCELLED';
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
        cancelled ? 'ring-2 ring-red-500' : waiting ? 'ring-2 ring-amber-400' : ''
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
              {p.department}: {partLabel(p)}
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

      {/* Перезаказ — только сигнал. Отменять что-либо автоматически нельзя:
          чек в Poster не отменяется, а второй заказ часто настоящий. */}
      {order.otherActiveOrders?.length > 0 && (
        <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">
          У клиента ещё{' '}
          {order.otherActiveOrders.length === 1 ? 'заказ' : 'заказы'} №
          {order.otherActiveOrders.join(', №')} — похоже на перезаказ.
          Уточните, что готовить, и лишний отмените вручную.
        </p>
      )}

      {/* Отмена — единственное, о чём принтер сказать не может: при отмене
          на планшет не уходит ничего, и чек лежит как живой. Строка уйдёт
          сама, когда кассир отклонит чек, — опрос это увидит. */}
      {cancelled && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <b>Заказ отменён</b>
          {order.cancelledBy === 'CUSTOMER' ? ' клиентом' : ''}
          {order.cancelReason ? ` — ${order.cancelReason}` : ''}.{' '}
          {order.receiptsToReject.length > 0 ? (
            <>
              Отклоните на планшете:{' '}
              {order.receiptsToReject
                .map((r) => `${r.department} — чек №${r.posterOrderId}`)
                .join('; ')}
              .
            </>
          ) : (
            'Чеки уже отклонены.'
          )}
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
          const locked = i.isGift || busy || cancelled;
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
          disabled={busy || picked.length === 0 || cancelled}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? 'Отмечаем…' : 'Этих позиций нет'}
        </button>
        {/* Только пока ждём ответа: после него сумма уже пересчитана и
            исправленный чек ушёл в кассу, вернуть строку нельзя. */}
        {waiting && missing.length > 0 && (
          <button
            onClick={() => send([])}
            disabled={busy}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/15"
          >
            Позиции нашлись
          </button>
        )}
        {!cancelled && order.type === 'DELIVERY' && (
          <button
            onClick={() => setWoltOpen(true)}
            disabled={busy}
            className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Wolt Drive
          </button>
        )}
        {!cancelled && (
          <button
            onClick={() => setCancelling(true)}
            disabled={busy}
            className={`${order.type === 'DELIVERY' ? '' : 'ml-auto'} rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-300`}
          >
            Отменить заказ
          </button>
        )}
      </div>
      {cancelling && (
        <CashierCancelDialog
          order={order}
          onClose={() => setCancelling(false)}
          onDone={() => { setCancelling(false); onDone(); }}
        />
      )}
      {woltOpen && (
        <WoltDriveDialog
          order={order}
          onClose={() => setWoltOpen(false)}
        />
      )}
    </li>
  );
}

const WOLT_STATUS_RU: Record<string, string> = {
  QUOTED: 'Рассчитано',
  REQUESTING: 'Отправляем в Wolt',
  INFO_RECEIVED: 'Заявка принята Wolt',
  RECEIVED: 'Заявка принята Wolt',
  VENUE_ACCEPTED: 'Принято',
  PICKUP_STARTED: 'Курьер едет в заведение',
  PICKUP_COMPLETED: 'Заказ забран',
  PICKED_UP: 'Заказ забран',
  DROPOFF_STARTED: 'Курьер едет к клиенту',
  DROPOFF_COMPLETED: 'Доставлено',
  DELIVERED: 'Доставлено',
  CUSTOMER_NO_SHOW: 'Клиент недоступен',
  CANCELLED: 'Отменено',
  REJECTED: 'Отменено',
  ERROR: 'Нужна ручная проверка',
};

/**
 * Сначала показываем цену и ETA, и только отдельная
 * кнопка создаёт платную доставку. Ответ с неопределённым
 * сетевым исходом не повторяем: два курьера дороже ручной проверки.
 */
function WoltDriveDialog({ order, onClose }: { order: CashierOrder; onClose: () => void }) {
  const [state, setState] = useState<WoltDriveState | null>(null);
  const [preparationTimeMinutes, setPreparationTimeMinutes] = useState(5);
  const [bagCount, setBagCount] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState(await api.get<WoltDriveState>(`/admin/orders/${order.id}/wolt-drive`));
  }, [order.id]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function quote() {
    setBusy('quote'); setError('');
    try {
      const delivery = await api.post<WoltDriveDelivery>(
        `/admin/orders/${order.id}/wolt-drive/quote`,
        { preparationTimeMinutes, bagCount },
      );
      setState((current) => current ? { ...current, delivery } : current);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function dispatch() {
    if (!window.confirm('Вызвать платного курьера Wolt по показанной цене?')) return;
    setBusy('dispatch'); setError('');
    try {
      const delivery = await api.post<WoltDriveDelivery>(
        `/admin/orders/${order.id}/wolt-drive/dispatch`,
      );
      setState((current) => current ? { ...current, delivery } : current);
    } catch (e) { setError((e as Error).message); await load().catch(() => undefined); }
    finally { setBusy(''); }
  }

  async function cancel() {
    const reason = window.prompt('Причина отмены Wolt Drive:');
    if (!reason?.trim()) return;
    setBusy('cancel'); setError('');
    try {
      const delivery = await api.patch<WoltDriveDelivery>(
        `/admin/orders/${order.id}/wolt-drive/cancel`,
        { reason: reason.trim() },
      );
      setState((current) => current ? { ...current, delivery } : current);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  const delivery = state?.delivery;
  const called = Boolean(delivery?.woltOrderReferenceId);
  const quoteFresh = delivery?.status === 'QUOTED' &&
    new Date(delivery.promiseValidUntil).getTime() > Date.now();
  const maxDeliveryPriceTenge = order.total >= 8000 ? 2000 : order.total >= 6000 ? 1500 : 1200;
  const quoteWithinLimit = Boolean(delivery &&
    delivery.quoteCurrency === 'KZT' &&
    delivery.quotePriceAmount <= maxDeliveryPriceTenge * 100);
  const canCancel = called && ![
    'CANCELLED',
    'REJECTED',
    'DROPOFF_COMPLETED',
    'DELIVERED',
    'CUSTOMER_NO_SHOW',
  ].includes(delivery!.status);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="w-full max-w-lg rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Wolt Drive · заказ №{order.number}</h3><p className="text-sm text-neutral-500">Резервный курьер — клиенту выбирать ничего не нужно.</p></div>
        <button onClick={onClose} className="text-xl text-neutral-400" aria-label="Закрыть">×</button>
      </div>

      {!state && !error && <p className="mt-4 text-sm text-neutral-500">Загрузка…</p>}
      {state && !state.settings.ready && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Wolt Drive ещё не настроен. Владелец должен ввести тестовые Merchant Key и Venue ID в «Настройках».
      </p>}
      {order.paymentMethod === 'CARD_ON_DELIVERY' && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Нельзя вызвать Wolt: клиент выбрал оплату картой курьеру, а терминал есть только у нашего курьера.
      </p>}

      {state?.settings.ready && !called && order.paymentMethod !== 'CARD_ON_DELIVERY' && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Заказ будет готов через
          <select value={preparationTimeMinutes} onChange={(e) => setPreparationTimeMinutes(Number(e.target.value))} disabled={!!busy} className="mt-1 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15">
            {[5, 10, 15, 20, 25, 30, 40, 50, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} минут</option>)}
          </select>
        </label>
        <label className="text-sm">Сколько пакетов
          <input type="number" min={1} max={20} value={bagCount} onChange={(e) => setBagCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} disabled={!!busy} className="mt-1 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15" />
        </label>
      </div>}

      {delivery && <div className="mt-4 rounded-xl bg-black/[.04] p-3 text-sm dark:bg-white/[.06]">
        <div className="flex justify-between gap-3"><b>{WOLT_STATUS_RU[delivery.status] ?? delivery.status}</b><b>{formatTenge(delivery.quotePriceAmount / 100)}</b></div>
        <p className="mt-1 text-neutral-500">Подача: {delivery.pickupEtaMinutes ?? '—'} мин · до клиента: {delivery.dropoffEtaMinutes ?? '—'} мин · пакетов: {delivery.bagCount}</p>
        {delivery.courierVehicleType && <p className="mt-1 text-neutral-500">Транспорт курьера: {delivery.courierVehicleType}</p>}
        {delivery.handshakePin && <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">Код передачи заказа: {delivery.handshakePin}</p>}
        {!called && <p className="mt-1 text-xs text-neutral-400">Расчёт действует до {new Date(delivery.promiseValidUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
        {!called && !quoteWithinLimit && <p className="mt-2 font-medium text-red-600">Вызов заблокирован: для заказа на {formatTenge(order.total)} лимит доставки — {formatTenge(maxDeliveryPriceTenge)}.</p>}
        {delivery.trackingUrl && <a href={delivery.trackingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sky-600 underline">Открыть отслеживание</a>}
        {delivery.errorMessage && <p className="mt-2 text-red-600">{delivery.errorMessage}. Сначала проверьте заказ в Wolt, не нажимайте повторно.</p>}
      </div>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button onClick={onClose} disabled={!!busy} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15">Закрыть</button>
        {state?.settings.ready && !called && order.paymentMethod !== 'CARD_ON_DELIVERY' && <button onClick={quote} disabled={!!busy} className="rounded-lg border border-sky-200 px-3 py-1.5 text-sm text-sky-700 disabled:opacity-40 dark:border-sky-900 dark:text-sky-300">{busy === 'quote' ? 'Считаем…' : 'Рассчитать'}</button>}
        {quoteFresh && <button onClick={dispatch} disabled={!!busy || !quoteWithinLimit} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">{busy === 'dispatch' ? 'Вызываем…' : 'Вызвать курьера'}</button>}
        {canCancel && <button onClick={cancel} disabled={!!busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-300">{busy === 'cancel' ? 'Отменяем…' : 'Отменить Wolt'}</button>}
      </div>
    </div>
  </div>;
}

function CashierCancelDialog({ order, onClose, onDone }: { order: CashierOrder; onClose: () => void; onDone: () => void }) {
  const [reasons, setReasons] = useState<AdminCancelReason[] | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get<AdminCancelReason[]>('/admin/cancel-reasons').then((list) => setReasons(list.filter((r) => r.isActive))).catch((e) => setError((e as Error).message)); }, []);
  async function submit() {
    setBusy(true); setError('');
    try { await api.patch(`/admin/orders/${order.id}/cancel`, { reasonId, ...(comment.trim() ? { comment: comment.trim() } : {}) }); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-neutral-900"><h3 className="text-lg font-semibold">Отмена заказа №{order.number}</h3><p className="mt-1 text-sm text-neutral-500">При онлайн-оплате сервер создаст возврат автоматически.</p>{error && <p className="mt-2 text-sm text-red-600">{error}</p>}<div className="mt-3 max-h-56 space-y-1 overflow-auto">{reasons?.map((reason) => <label key={reason.id} className="flex cursor-pointer gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"><input type="radio" checked={reasonId === reason.id} onChange={() => setReasonId(reason.id)} /><span>{reason.label}</span></label>) ?? <p className="text-sm text-neutral-500">Загрузка…</p>}</div><textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} rows={2} placeholder="Комментарий (необязательно)" className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15" /><div className="mt-4 flex justify-end gap-2"><button onClick={onClose} disabled={busy} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15">Не отменять</button><button onClick={submit} disabled={busy || !reasonId} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">{busy ? 'Отменяем…' : 'Отменить'}</button></div></div></div>;
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
