'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Mini App курьера (docs/COURIER_SYSTEM_SPEC.md §5–7). Открывается кнопкой
 * «Открыть» в боте. Логина нет: личность курьера — подписанные Telegram
 * данные запуска, сервер проверяет подпись токеном бота.
 *
 * Сканер QR — встроенный в Telegram (showScanQrPopup), отдельное
 * приложение камеры не нужно.
 *
 * Действия, после которых нельзя передумать («Поехали», «Доставлен»), —
 * слайдером, а не кнопкой: в кармане или на бегу кнопку легко нажать
 * случайно, а протянуть ползунок до конца — нет.
 */

interface Task {
  id: string;
  kind: 'DELIVERY' | 'PICKUP' | 'EXTRA_TRIP';
  status: 'ASSIGNED' | 'PICKED_UP';
  number: number | string;
  /** Заказ старого приложения или сайта (из Poster) */
  external?: boolean;
  items: string;
  /** Что лежит в пакете — курьер сверяет галочками перед «Поехали» */
  checklist: { id: string; name: string; qty: number; note: string }[];
  payment: string;
  cash: number;
  needsTerminal: boolean;
  assignedAt: string | null;
  pickedUpAt: string | null;
  extraReason: string | null;
  /** Связка по 2 заказа: общий id и порядок развоза */
  batchId: string | null;
  batchSeq: number | null;
  /** Второй заказ связки: адрес откроется после доставки этого номера */
  afterNumber: number | string | null;
  address?: string | null;
  addressComment?: string | null;
  mapUrl?: string | null;
  phone?: string | null;
  customerName?: string | null;
  comment?: string | null;
}

interface QueuePerson {
  id: string;
  name: string;
  photo: boolean;
  me: boolean;
}

interface Queue {
  waiting: QueuePerson[];
  onWay: (QueuePerson & { state: 'ASSIGNED' | 'ON_DELIVERY' | 'RETURNING'; minutes: number | null })[];
  pause: (QueuePerson & { minutesLeft: number | null })[];
}

interface Me {
  courier: { name: string; status: 'PENDING' | 'ACTIVE' };
  shift: {
    state: 'WAITING' | 'ASSIGNED' | 'ON_DELIVERY' | 'RETURNING' | 'ON_PAUSE' | 'AWAY';
    startedAt: string;
    queuePosition: number | null;
    pauseUntil: string | null;
    pausesLeft: number;
  } | null;
  pickupTimeoutMin: number;
  pauseMin: number;
  tasks: Task[];
  queue?: Queue;
  today: { deliveries: number; earned: number };
  cash: {
    balance: number;
    pendingHandover: { amount: number; createdAt: string } | null;
    /** Наличные заказы за сутки: по ним можно отметить «клиент оплатил иначе» */
    cashOrders?: {
      taskId: string;
      number: string;
      amount: number;
      paidOtherwise: { status: 'PENDING' | 'CONFIRMED' | 'REJECTED'; paidBy: 'CARD' | 'KASPI' | null } | null;
    }[];
    settlement: { earned: number; cashHeld: number; courierPays: number; venuePays: number } | null;
  };
  pending?: boolean;
}

const FAIL_REASONS = ['Клиент не отвечает', 'Неверный адрес', 'Клиент отказался'];

const tenge = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

/** «Иванов Иван Иванович» → «Иван И.» */
function shortName(full: string) {
  const [last, first] = full.trim().split(/\s+/);
  return first ? `${first} ${last.charAt(0)}.` : (last ?? '');
}

function tg(): any {
  return typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
}

export default function CourierPage() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failFor, setFailFor] = useState<Task | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Галочки комплектации по заказам: живут только на экране, на сервер
  // уходят вместе с «Поехали»
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  // Селфи коллег: картинку нельзя запросить обычным <img> — нужен заголовок
  // с подписью Telegram, поэтому качаем сами и держим как blob-ссылки
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const photoRequested = useRef(new Set<string>());
  const tenant = useRef('');

  // SDK Telegram подключаем сами: страница живёт в общей админке
  useEffect(() => {
    tenant.current = new URLSearchParams(window.location.search).get('t') ?? '';
    const done = () => {
      const app = tg();
      app?.ready();
      app?.expand();
      // Иначе движение пальцем по ползунку Telegram принимает за жест
      // «закрыть приложение»
      app?.disableVerticalSwipes?.();
      setReady(true);
    };
    if (tg()) return done();
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = done;
    s.onerror = done;
    document.head.appendChild(s);
  }, []);

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${api.raw}/courier${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant.current,
        'X-Telegram-Init-Data': tg()?.initData ?? '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(json.message ?? 'Нет доступа'), { fatal: true });
    }
    if (!res.ok) throw new Error(json.message ?? `Ошибка ${res.status}`);
    return json as T;
  }, []);

  const load = useCallback(async () => {
    try {
      setMe(await request<Me>('/me'));
      setFatal(null);
    } catch (e: any) {
      if (e?.fatal) setFatal(e.message);
    }
  }, [request]);

  useEffect(() => {
    if (!ready) return;
    if (!tg()?.initData) {
      setFatal('Откройте эту страницу кнопкой «Открыть» в боте');
      return;
    }
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [ready, load]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const q = me?.queue;
    if (!q) return;
    for (const p of [...q.waiting, ...q.onWay, ...q.pause]) {
      if (!p.photo || photoRequested.current.has(p.id)) continue;
      photoRequested.current.add(p.id);
      fetch(`${api.raw}/courier/photo/${encodeURIComponent(p.id)}`, {
        headers: { 'X-Tenant': tenant.current, 'X-Telegram-Init-Data': tg()?.initData ?? '' },
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (b) setPhotos((prev) => ({ ...prev, [p.id]: URL.createObjectURL(b) }));
        })
        // Без фото останутся инициалы — не повод показывать ошибку
        .catch(() => {});
    }
  }, [me?.queue]);

  // Звонилку открывает tel:, но в части телефонов Telegram её не пускает —
  // поэтому номер ещё и приходит сообщением от бота, там он нажимается
  async function phoneToChat(t: Task) {
    setNotice(null);
    try {
      await request(`/tasks/${t.id}/phone`, {});
      setNotice('Номер клиента отправлен в чат с ботом. Если звонок не начался, нажмите на номер там.');
      setTimeout(() => setNotice(null), 8000);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      const next = await request<Me>(path, body);
      setMe(next);
      tg()?.HapticFeedback?.notificationOccurred('success');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      tg()?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setBusy(false);
    }
  }

  function scan(onCode: (code: string) => void) {
    const app = tg();
    if (!app?.showScanQrPopup || !app.isVersionAtLeast?.('6.4')) {
      setError('Обновите Telegram: эта версия не умеет сканировать QR');
      return;
    }
    app.showScanQrPopup({ text: 'Отсканируйте QR на планшете раздачи' }, (text: string) => {
      app.closeScanQrPopup();
      onCode(text);
      return true;
    });
  }

  function delivered(task: Task) {
    // Геолокация — дополнительная проверка, без неё «Доставлен» тоже проходит
    const send = (lat?: number, lng?: number) =>
      act(`/tasks/${task.id}/delivered`, lat !== undefined ? { lat, lng } : {});
    if (!navigator.geolocation) return send();
    navigator.geolocation.getCurrentPosition(
      (p) => send(p.coords.latitude, p.coords.longitude),
      () => send(),
      { timeout: 4000, maximumAge: 60_000 },
    );
  }

  if (fatal) {
    return (
      <Shell>
        <p className="mt-20 text-center text-lg">{fatal}</p>
      </Shell>
    );
  }
  if (!me) {
    return (
      <Shell>
        <p className="mt-20 text-center opacity-60">Загружаем…</p>
      </Shell>
    );
  }

  const assigned = me.tasks.filter((t) => t.status === 'ASSIGNED');
  // Заказы связки — одной карточкой, в порядке развоза
  const assignedGroups: Task[][] = [];
  for (const t of assigned) {
    const g = t.batchId ? assignedGroups.find((x) => x[0].batchId === t.batchId) : undefined;
    if (g) g.push(t);
    else assignedGroups.push([t]);
  }
  for (const g of assignedGroups) g.sort((a, b) => (a.batchSeq ?? 0) - (b.batchSeq ?? 0));
  const onWay = me.tasks.filter((t) => t.status === 'PICKED_UP');
  const state = me.shift?.state;
  const canCheckIn = me.tasks.length === 0 && state !== 'WAITING' && state !== 'ON_PAUSE';

  return (
    <Shell>
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div className="truncate text-lg font-semibold">{shortName(me.courier.name)}</div>
        <div className="whitespace-nowrap text-sm opacity-60">
          сегодня {me.today.deliveries} · {me.today.earned.toLocaleString('ru-RU')} ₸
        </div>
      </header>

      {me.queue && <QueueStrip queue={me.queue} photos={photos} />}

      {me.courier.status === 'PENDING' && (
        <Card tone="warn">
          <b>Заявка ждёт проверки.</b> Отсканируйте QR у раздачи и покажите кассиру
          удостоверение: она подтвердит вас, и начнут приходить заказы.
        </Card>
      )}

      {onWay.map((t) =>
        t.afterNumber ? (
          <Card key={t.id}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-3xl font-black">№{t.number}</span>
              <span className="text-sm opacity-60">второй по пути</span>
            </div>
            <div className="opacity-70">Адрес откроется после доставки №{t.afterNumber}</div>
            <div className="mt-2">{t.items}</div>
            <div className="mt-1 font-semibold">{t.payment}</div>
          </Card>
        ) : (
        <Card key={t.id}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-3xl font-black">№{t.number}</span>
            {t.pickedUpAt && (
              <span className="text-sm opacity-60">
                в пути {Math.floor((nowMs - new Date(t.pickedUpAt).getTime()) / 60_000)} мин
              </span>
            )}
          </div>
          <div className="text-lg font-semibold">{t.address ?? 'адрес не указан'}</div>
          {t.addressComment && <div className="opacity-70">{t.addressComment}</div>}
          {t.comment && <div className="mt-1 opacity-70">Комментарий: {t.comment}</div>}
          <div className="mt-2">{t.items}</div>
          <div className="mt-1 font-semibold">{t.payment}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {t.phone && (
              <a href={`tel:${t.phone}`} onClick={() => phoneToChat(t)} className="btn-secondary">
                Позвонить{t.customerName ? ` · ${t.customerName}` : ''}
              </a>
            )}
            {t.mapUrl && (
              <a href={t.mapUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                Открыть в 2ГИС
              </a>
            )}
          </div>
          {t.phone && <div className="mt-2 select-all text-sm opacity-70">Телефон: {t.phone}</div>}
          <div className="mt-3">
            <SlideButton label="Заказ доставлен" disabled={busy} onComplete={() => delivered(t)} />
          </div>
          <button disabled={busy} onClick={() => setFailFor(t)} className="btn-link mt-2">
            Не удалось доставить
          </button>
        </Card>
        ),
      )}

      {assignedGroups.map((group) => {
        // Связку забирают одним «Поехали»: оба пакета, одни галочки, один скан
        const lead = group[0];
        const left = group
          .map((t) =>
            t.assignedAt
              ? me.pickupTimeoutMin * 60 -
                Math.floor((nowMs - new Date(t.assignedAt).getTime()) / 1000)
              : null,
          )
          .filter((x): x is number => x !== null)
          .sort((a, b) => a - b)[0] ?? null;
        const allMarks = group.flatMap((t) => checked[t.id] ?? []);
        const total = group.reduce((n, t) => n + t.checklist.length, 0);
        const done = group.reduce(
          (n, t) => n + t.checklist.filter((i) => (checked[t.id] ?? []).includes(i.id)).length,
          0,
        );
        const allChecked = done === total;
        const batch = group.length > 1;
        return (
          <Card key={lead.id} tone="accent">
            {batch && (
              <div className="mb-2 text-base font-semibold">
                Два заказа по пути: сначала №{group[0].number}, потом №{group[1].number}
              </div>
            )}
            {group.map((t, gi) => {
              const marks = checked[t.id] ?? [];
              const toggle = (id: string) => {
                tg()?.HapticFeedback?.selectionChanged();
                setChecked((prev) => {
                  const cur = prev[t.id] ?? [];
                  return {
                    ...prev,
                    [t.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
                  };
                });
              };
              return (
                <div
                  key={t.id}
                  className={gi > 0 ? 'mt-4 border-t pt-3' : ''}
                  style={gi > 0 ? { borderColor: 'var(--tg-theme-hint-color, #ccc)' } : undefined}
                >
                  <div className="text-sm font-semibold uppercase opacity-70">
                    {t.kind === 'EXTRA_TRIP'
                      ? 'Довоз'
                      : batch
                        ? `Пакет ${gi + 1} из ${group.length}`
                        : 'Заберите на раздаче'}
                    {t.external && ' · старое приложение'}
                  </div>
                  <div className="text-4xl font-black">№{t.number}</div>
                  {t.checklist.length > 0 ? (
                    <>
                      {gi === 0 && (
                        <div className="mt-2 text-sm opacity-70">
                          Проверьте {batch ? 'пакеты' : 'пакет'} и отметьте каждую позицию
                        </div>
                      )}
                      <ul className="mt-2">
                        {t.checklist.map((i) => {
                          const on = marks.includes(i.id);
                          return (
                            <li key={i.id}>
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                onClick={() => toggle(i.id)}
                                className="flex w-full items-center gap-3 border-b py-3 text-left last:border-b-0"
                                style={{ borderColor: 'var(--tg-theme-secondary-bg-color, #eee)' }}
                              >
                                <span
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-lg font-black"
                                  style={
                                    on
                                      ? {
                                          background: 'var(--tg-theme-button-color, #2481cc)',
                                          borderColor: 'var(--tg-theme-button-color, #2481cc)',
                                          color: 'var(--tg-theme-button-text-color, #fff)',
                                        }
                                      : { borderColor: 'var(--tg-theme-hint-color, #999)' }
                                  }
                                >
                                  {on ? '✓' : ''}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-lg leading-tight">{i.name}</span>
                                  {i.note && <span className="block text-sm opacity-60">{i.note}</span>}
                                </span>
                                {i.qty > 1 && (
                                  <span className="shrink-0 text-xl font-black">×{i.qty}</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div className="mt-1 text-lg">{t.items}</div>
                  )}
                  <div className="mt-2 font-semibold">{t.payment}</div>
                </div>
              );
            })}
            {left !== null && left > 0 && (
              <div className="mt-1 text-sm opacity-70">
                заберите в течение {Math.ceil(left / 60)} мин
              </div>
            )}
            <div className="mt-3">
              <SlideButton
                label={
                  // Длинное «Поехали — сканировать QR» не влезает на узкий
                  // телефон; про QR скажет сам сканер
                  allChecked ? 'Поехали' : `Отмечено ${done} из ${total}`
                }
                disabled={busy || !allChecked}
                onComplete={() =>
                  scan((qr) => act(`/tasks/${lead.id}/picked-up`, { qr, items: allMarks }))
                }
              />
            </div>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('Отметить без скана? Доставка засчитается с пометкой.')) {
                  act(`/tasks/${lead.id}/picked-up-manual`);
                }
              }}
              className="btn-link mt-2"
            >
              Уже уехал, забыл отсканировать
            </button>
          </Card>
        );
      })}

      {me.tasks.length === 0 && state === 'WAITING' && (
        <Card>
          <div className="text-center">
            <div className="text-sm uppercase opacity-60">Вы в очереди</div>
            <div className="text-6xl font-black">{me.shift?.queuePosition ?? '—'}</div>
            <div className="mt-2 opacity-70">Заказ придёт сам, ждите у раздачи</div>
          </div>
          {(me.shift?.pausesLeft ?? 0) > 0 && (
            <button
              disabled={busy}
              onClick={() => act('/pause')}
              className="btn-secondary mt-3 w-full"
            >
              Пауза {me.pauseMin} мин · осталось {me.shift?.pausesLeft}
            </button>
          )}
        </Card>
      )}

      {me.tasks.length === 0 && state === 'ON_PAUSE' && (
        <Card tone="warn">
          <div className="text-center">
            <div className="text-sm uppercase opacity-60">Пауза</div>
            <div className="text-4xl font-black">
              {me.shift?.pauseUntil
                ? `${Math.max(Math.ceil((new Date(me.shift.pauseUntil).getTime() - nowMs) / 60_000), 0)} мин`
                : ''}
            </div>
            <div className="mt-2 opacity-70">Заказы не приходят, место в очереди сохранено</div>
          </div>
          <button disabled={busy} onClick={() => act('/resume')} className="btn-primary mt-3">
            Вернуться в очередь
          </button>
        </Card>
      )}

      {canCheckIn && (
        <>
          {state === 'RETURNING' && (
            <Card>Вернулись к раздаче? Отметьтесь, чтобы снова встать в очередь.</Card>
          )}
          {state === 'AWAY' && (
            <Card tone="warn">Вы вне очереди. Отметьтесь у раздачи, чтобы получать заказы.</Card>
          )}
          <button
            disabled={busy}
            onClick={() => scan((qr) => act('/check-in', { qr }))}
            className="btn-primary h-20 text-xl"
          >
            Я на месте — сканировать QR
          </button>
        </>
      )}

      {me.cash.settlement && (
        <Card tone="warn">
          <div className="font-semibold">Расчёт за смену ждёт кассира</div>
          <div className="mt-1 text-sm opacity-80">
            заработано {tenge(me.cash.settlement.earned)} · на руках {tenge(me.cash.settlement.cashHeld)}
          </div>
          <div className="mt-2 text-lg font-bold">
            {me.cash.settlement.courierPays > 0
              ? `Сдайте кассиру ${tenge(me.cash.settlement.courierPays)}`
              : me.cash.settlement.venuePays > 0
                ? `Кассир заплатит вам ${tenge(me.cash.settlement.venuePays)}`
                : 'Никто никому не должен'}
          </div>
        </Card>
      )}

      {!me.cash.settlement &&
        (me.cash.balance > 0 ||
          me.cash.pendingHandover ||
          me.cash.cashOrders?.some((o) => o.paidOtherwise?.status === 'PENDING')) && (
        <Card>
          <div className="flex items-baseline justify-between">
            <span className="opacity-70">Наличные на руках</span>
            <span className="text-xl font-bold">{tenge(me.cash.balance)}</span>
          </div>
          {me.cash.pendingHandover ? (
            <div className="mt-2 text-sm">
              Ждём, когда кассир подтвердит {tenge(me.cash.pendingHandover.amount)}
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => act('/cash/hand-in')}
              className="btn-secondary mt-3 w-full"
            >
              Сдаю кассиру {tenge(me.cash.balance)}
            </button>
          )}
          {(me.cash.cashOrders?.length ?? 0) > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer opacity-70">
                Клиент заплатил не наличными? Отметьте заказ
              </summary>
              <ul className="mt-2 space-y-2">
                {me.cash.cashOrders!.map((o) => (
                  <li key={o.taskId} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      №{o.number} · {tenge(o.amount)}
                    </span>
                    {o.paidOtherwise?.status === 'PENDING' ? (
                      <span className="opacity-70">ждём кассира</span>
                    ) : o.paidOtherwise?.status === 'CONFIRMED' ? (
                      <span className="text-emerald-600">
                        {o.paidOtherwise.paidBy === 'KASPI' ? 'Kaspi' : 'картой'} — подтверждено
                      </span>
                    ) : (
                      <span className="flex gap-2">
                        {o.paidOtherwise?.status === 'REJECTED' && <span className="text-red-600">кассир не подтвердил</span>}
                        <button
                          disabled={busy}
                          className="btn-secondary px-2 py-1"
                          onClick={() => {
                            if (confirm(`№${o.number}: клиент оплатил картой через терминал? Кассир проверит.`))
                              act(`/tasks/${o.taskId}/paid-otherwise`, { paidBy: 'CARD' });
                          }}
                        >
                          Картой
                        </button>
                        <button
                          disabled={busy}
                          className="btn-secondary px-2 py-1"
                          onClick={() => {
                            if (confirm(`№${o.number}: клиент оплатил через Kaspi? Кассир проверит.`))
                              act(`/tasks/${o.taskId}/paid-otherwise`, { paidBy: 'KASPI' });
                          }}
                        >
                          Kaspi
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {me.shift && me.tasks.length === 0 && (
        <button
          disabled={busy}
          onClick={() => {
            if (confirm('Закончить смену? Кассиру уйдёт расчёт за смену.')) act('/shift/end');
          }}
          className="btn-link mt-6"
        >
          Закончить смену
        </button>
      )}

      {notice && (
        <button onClick={() => setNotice(null)} className="mt-4 w-full rounded-xl bg-green-600 p-3 text-white">
          {notice}
        </button>
      )}

      {error && (
        <button onClick={() => setError(null)} className="mt-4 w-full rounded-xl bg-red-600 p-3 text-white">
          {error}
        </button>
      )}

      {failFor && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/40" onClick={() => setFailFor(null)}>
          <div className="w-full rounded-t-2xl p-4" style={{ background: 'var(--tg-theme-bg-color, #fff)' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold">№{failFor.number}: почему не удалось?</div>
            {FAIL_REASONS.map((r) => (
              <button
                key={r}
                className="btn-secondary mb-2 w-full"
                onClick={() => {
                  const t = failFor;
                  setFailFor(null);
                  act(`/tasks/${t.id}/failed`, { reason: r });
                }}
              >
                {r}
              </button>
            ))}
            <button
              className="btn-secondary mb-2 w-full"
              onClick={() => {
                const reason = prompt('Что случилось?')?.trim();
                if (!reason) return;
                const t = failFor;
                setFailFor(null);
                act(`/tasks/${t.id}/failed`, { reason });
              }}
            >
              Другое…
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Цвета берём из темы Telegram: приложение выглядит частью чата */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4"
      style={{
        background: 'var(--tg-theme-secondary-bg-color, #f4f4f5)',
        color: 'var(--tg-theme-text-color, #111)',
      }}
    >
      <style>{`
        .btn-primary { display:block; width:100%; border-radius:14px; padding:14px; font-weight:700; font-size:18px;
          background: var(--tg-theme-button-color, #2481cc); color: var(--tg-theme-button-text-color, #fff); }
        .btn-primary:disabled { opacity:.5 }
        .btn-secondary { display:block; text-align:center; border-radius:12px; padding:12px; font-weight:600;
          background: var(--tg-theme-secondary-bg-color, #eee); color: var(--tg-theme-link-color, #2481cc); }
        .btn-link { display:block; width:100%; padding:8px; font-size:14px; color: var(--tg-theme-hint-color, #888); }
      `}</style>
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}

function Card({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'accent' }) {
  const ring =
    tone === 'warn' ? 'ring-2 ring-amber-400' : tone === 'accent' ? 'ring-2 ring-emerald-500' : '';
  return (
    <div
      className={`mb-3 rounded-2xl p-4 ${ring}`}
      style={{ background: 'var(--tg-theme-bg-color, #fff)' }}
    >
      {children}
    </div>
  );
}

/**
 * Кнопка-ползунок: срабатывает, только если протянуть кружок почти до
 * конца. Отпустил раньше — кружок возвращается, ничего не происходит.
 * С клавиатуры — Enter или пробел на кружке.
 */
function SlideButton({
  label,
  disabled,
  onComplete,
}: {
  label: string;
  disabled?: boolean;
  onComplete: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; max: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const THUMB = 56;
  const PAD = 4;

  // Ползунок стоит в начале, пока действие недоступно
  useEffect(() => {
    if (disabled) setDx(0);
  }, [disabled]);

  function finish() {
    tg()?.HapticFeedback?.impactOccurred('medium');
    onComplete();
    // Если сканер закрыли без кода, ползунок должен быть готов снова
    setTimeout(() => setDx(0), 400);
  }

  return (
    <div
      ref={track}
      className="relative select-none overflow-hidden rounded-full"
      style={{
        height: THUMB + PAD * 2,
        background: 'var(--tg-theme-button-color, #2481cc)',
        color: 'var(--tg-theme-button-text-color, #fff)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-bold"
        style={{ paddingLeft: THUMB, opacity: Math.max(1 - dx / 160, 0.15) }}
      >
        {label}
      </div>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className="absolute flex items-center justify-center rounded-full text-2xl font-black shadow"
        style={{
          top: PAD,
          left: PAD,
          width: THUMB,
          height: THUMB,
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
          background: 'var(--tg-theme-button-text-color, #fff)',
          color: 'var(--tg-theme-button-color, #2481cc)',
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          if (disabled || !track.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX - dx, max: track.current.clientWidth - THUMB - PAD * 2 };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setDx(Math.min(Math.max(e.clientX - start.current.x, 0), start.current.max));
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          setDragging(false);
          if (!s) return;
          const pos = Math.min(Math.max(e.clientX - s.x, 0), s.max);
          if (pos >= s.max * 0.85) {
            setDx(s.max);
            finish();
          } else {
            setDx(0);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setDx(0);
        }}
        onKeyDown={(e) => {
          if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          finish();
        }}
        // Клик без протягивания ничего не делает — в этом смысл ползунка
        onClick={(e) => e.preventDefault()}
      >
        →
      </button>
    </div>
  );
}

/**
 * Очередь у раздачи, как у Додо: кто ждёт (с номером), кто в пути (с
 * минутами), кто на паузе. Каждый видит, что заказы идут по порядку.
 */
function QueueStrip({ queue, photos }: { queue: Queue; photos: Record<string, string> }) {
  const groups: { title: string; people: { p: QueuePerson; badge: string }[] }[] = [
    {
      title: 'Ждут',
      people: queue.waiting.map((p, i) => ({ p, badge: String(i + 1) })),
    },
    {
      title: 'В пути',
      people: queue.onWay.map((p) => ({
        p,
        badge:
          p.state === 'RETURNING'
            ? 'назад'
            : p.state === 'ASSIGNED'
              ? 'берёт'
              : `${p.minutes ?? 0} мин`,
      })),
    },
    {
      title: 'Пауза',
      people: queue.pause.map((p) => ({
        p,
        badge: p.minutesLeft !== null ? `${p.minutesLeft} мин` : '',
      })),
    },
  ].filter((g) => g.people.length > 0);
  if (groups.length === 0) return null;

  return (
    <div
      className="-mx-4 mb-3 flex gap-4 overflow-x-auto px-4 pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {groups.map((g) => (
        <div key={g.title} className="shrink-0">
          <div className="mb-1 text-xs font-semibold uppercase opacity-50">{g.title}</div>
          <div className="flex gap-2">
            {g.people.map(({ p, badge }) => (
              <div key={p.id} className="flex w-14 flex-col items-center">
                <div className="relative">
                  <Avatar name={p.name} src={photos[p.id]} me={p.me} />
                  {badge && (
                    <span
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 text-[11px] font-bold leading-4"
                      style={{
                        background: p.me
                          ? 'var(--tg-theme-button-color, #2481cc)'
                          : 'var(--tg-theme-bg-color, #fff)',
                        color: p.me
                          ? 'var(--tg-theme-button-text-color, #fff)'
                          : 'var(--tg-theme-text-color, #111)',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 w-full truncate text-center text-xs">
                  {p.me ? 'Вы' : p.name.split(' ')[0]}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Avatar({ name, src, me }: { name: string; src?: string; me: boolean }) {
  const ring = me
    ? { boxShadow: '0 0 0 3px var(--tg-theme-button-color, #2481cc)' }
    : {};
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} className="h-12 w-12 rounded-full object-cover" style={ring} />
    );
  }
  const initials = name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2);
  return (
    <div
      className="flex h-12 w-12 items-center justify-center rounded-full text-base font-bold"
      style={{
        background: 'var(--tg-theme-bg-color, #fff)',
        color: 'var(--tg-theme-hint-color, #888)',
        ...ring,
      }}
    >
      {initials}
    </div>
  );
}
