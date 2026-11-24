'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Планшет раздачи (docs/COURIER_SYSTEM_SPEC.md §4).
 *
 * Висит на стене, поэтому без админского входа: у устройства свой токен,
 * который один раз приходит ссылкой `/dispatch#token=…`. Единственное
 * действие раздачи — нажать на плитку, когда пакет собран.
 *
 * Доску опрашиваем каждые 3 секунды. WebSocket не нужен: заказов десятки,
 * а опрос переживает обрыв Wi-Fi без всякой логики переподключения.
 *
 * Раз в несколько часов, когда никто ничего не нажимает, страница
 * перезагружается сама: дешёвый планшет круглые сутки на одной вкладке
 * иначе копит память браузера.
 */

const TOKEN_KEY = 'pizzburg_dispatch_token';
const POLL_MS = 3000;
const RELOAD_AFTER_MS = 6 * 60 * 60_000;
const RELOAD_IDLE_MS = 2 * 60_000;

type TaskStatus =
  | 'NEW'
  | 'READY'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'HANDED_OVER'
  | 'FAILED'
  | 'CANCELLED';

interface Task {
  id: string;
  kind: 'DELIVERY' | 'PICKUP' | 'EXTRA_TRIP';
  status: TaskStatus;
  /** Наш номер или последние цифры чека Poster у заказа старого приложения */
  number: number | string;
  /** Заказ старого приложения или сайта, подтянутый из Poster */
  external?: boolean;
  createdAt: string;
  scheduledAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  doneAt: string | null;
  courier: string | null;
  /** Связка по 2 заказа: порядок развоза (1, 2) */
  batchSeq: number | null;
  /** Позиции других отделов (Sunday): «Готов» — только когда их принесли */
  otherDepartments: { name: string; count: number; only: boolean }[];
  cash: number;
  needsTerminal: boolean;
  extraReason: string | null;
  alert: 'NO_COURIER' | 'NOT_READY' | 'ON_WAY' | null;
  items: { name: string; qty: number; department: string | null; modifiers: string[] }[];
  /** Для большой карточки по долгому нажатию */
  details?: {
    address: string | null;
    addressComment: string | null;
    phone: string | null;
    customerName: string | null;
    comment: string | null;
    payment: string;
    cancellable: boolean;
  };
}

const ALERT_TEXT: Record<NonNullable<Task['alert']>, string> = {
  NO_COURIER: 'нет курьера',
  NOT_READY: 'курьер ждёт',
  ON_WAY: 'долго в пути',
};

interface Courier {
  shiftId: string;
  courierId: string;
  name: string;
  photo: boolean;
  carrying: boolean;
  state: 'WAITING' | 'ASSIGNED' | 'ON_DELIVERY' | 'RETURNING' | 'ON_PAUSE' | 'AWAY';
  queuedAt: string | null;
  pauseUntil: string | null;
}

interface Board {
  now: string;
  device: { name: string };
  readyUndoSec: number;
  qr: { svg: string; refreshInMs: number };
  checkIns: { id: string; name: string; at: string }[];
  cashAlerts: { id: string; text: string }[];
  couriers: Courier[];
  tasks: Task[];
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${api.raw}${path}`, {
    method,
    headers: {
      'X-Device-Token': token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Ошибка ${res.status}`);
  }
  return res.json();
}

const minutes = (fromIso: string, nowMs: number) =>
  Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60_000));

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const tenge = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

export default function DispatchPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; number: number | string; until: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [extraOpen, setExtraOpen] = useState(false);
  const [courierOpen, setCourierOpen] = useState<string | null>(null);
  // Большая карточка заказа: долгое нажатие на плитку
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  // Селфи курьеров: картинке нужен заголовок с токеном планшета,
  // поэтому качаем сами и держим как blob-ссылки
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const photoRequested = useRef(new Set<string>());
  // Разница часов планшета и сервера: таймеры считаем по серверу
  const skew = useRef(0);

  // Токен из ссылки подключения → localStorage, а из адреса убираем
  useEffect(() => {
    const m = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
    if (m) {
      try {
        localStorage.setItem(TOKEN_KEY, m[1]);
      } catch {
        /* приватный режим: работаем до перезагрузки */
      }
      history.replaceState(null, '', window.location.pathname);
      setToken(m[1]);
    } else {
      setToken(readToken());
    }
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const b = await call<Board>('/dispatch/board', token);
      skew.current = new Date(b.now).getTime() - Date.now();
      setBoard(b);
      setOffline(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'UNAUTHORIZED') {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ничего */
        }
        setToken(null);
        return;
      }
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now() + skew.current), 1000);
    return () => clearInterval(t);
  }, []);

  // Плановая перезагрузка: только после долгой работы и паузы в нажатиях
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    const started = Date.now();
    const touch = () => (lastTouch.current = Date.now());
    window.addEventListener('pointerdown', touch);
    const t = setInterval(() => {
      const now = Date.now();
      if (now - started > RELOAD_AFTER_MS && now - lastTouch.current > RELOAD_IDLE_MS) {
        window.location.reload();
      }
    }, 60_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      clearInterval(t);
    };
  }, []);

  // Экран не гаснет, пока страница открыта (где браузер это умеет)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* не поддерживается — настройте сон в самом планшете */
      }
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => undefined);
    };
  }, []);

  async function act(task: Task, action: 'ready' | 'undo-ready' | 'handed-over' | 'cancel') {
    if (!token) return;
    setError(null);
    try {
      await call(`/dispatch/tasks/${task.id}/${action}`, token, 'POST');
      if (action === 'ready' && board) {
        setUndo({ id: task.id, number: task.number, until: Date.now() + board.readyUndoSec * 1000 });
      }
      if (action === 'undo-ready') setUndo(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createExtraTrip(number: number, reason: string) {
    if (!token) return;
    setError(null);
    try {
      await call('/dispatch/extra-trips', token, 'POST', { number, reason });
      setExtraOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!token || !board) return;
    for (const c of board.couriers) {
      if (!c.photo || photoRequested.current.has(c.courierId)) continue;
      photoRequested.current.add(c.courierId);
      fetch(`${api.raw}/dispatch/couriers/${c.courierId}/photo`, {
        headers: { 'X-Device-Token': token },
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => b && setPhotos((p) => ({ ...p, [c.courierId]: URL.createObjectURL(b) })))
        .catch(() => undefined);
    }
  }, [board, token]);

  async function courierAction(shiftId: string, action: 'away' | 'end-shift') {
    if (!token) return;
    setError(null);
    try {
      await call(`/dispatch/couriers/${shiftId}/${action}`, token, 'POST');
      setCourierOpen(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!undo) return;
    const left = undo.until - Date.now();
    const t = setTimeout(() => setUndo(null), Math.max(0, left));
    return () => clearTimeout(t);
  }, [undo]);

  if (!ready) return null;

  if (!token) {
    return (
      <Screen>
        <div className="m-auto max-w-md text-center">
          <h1 className="mb-3 text-3xl font-bold">Планшет не подключён</h1>
          <p className="text-lg text-neutral-500">
            Владелец открывает в админке «Настройки → Планшеты раздачи», нажимает
            «Подключить планшет» и открывает полученную ссылку на этом устройстве.
          </p>
        </div>
      </Screen>
    );
  }

  if (!board) {
    return (
      <Screen>
        <p className="m-auto text-2xl text-neutral-500">
          {offline ? 'Нет связи с сервером…' : 'Загружаем…'}
        </p>
      </Screen>
    );
  }

  const byStatus = (statuses: TaskStatus[]) =>
    board.tasks.filter((t) => statuses.includes(t.status));
  const fresh = byStatus(['NEW']);
  const readyCol = byStatus(['READY', 'ASSIGNED']);
  const onWay = byStatus(['PICKED_UP']);
  const done = byStatus(['DELIVERED', 'HANDED_OVER', 'FAILED']);
  const waiting = board.couriers.filter((c) => c.state === 'WAITING');
  const others = board.couriers.filter((c) => c.state !== 'WAITING');

  return (
    <Screen>
      <header className="flex items-center gap-4 border-b border-black/10 px-5 py-3">
        <div className="text-3xl font-bold tabular-nums">
          {new Date(nowMs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            На месте
          </span>
          {waiting.length === 0 && <span className="text-lg text-neutral-400">никого</span>}
          {/* Нажатие на курьера — «Уехал» или «Закончил смену» */}
          {waiting.map((c, i) => (
            <button
              key={c.shiftId}
              onClick={() => setCourierOpen(c.shiftId)}
              className="flex items-center gap-2 rounded-full bg-emerald-100 py-1 pl-1 pr-3 text-lg font-semibold text-emerald-900 active:scale-[.97]"
            >
              <Face name={c.name} src={photos[c.courierId]} />
              {i + 1}. {c.name}
              {c.queuedAt && (
                <span className="font-normal text-emerald-700">{minutes(c.queuedAt, nowMs)} мин</span>
              )}
            </button>
          ))}
          {others.map((c) => (
            <button
              key={c.shiftId}
              onClick={() => setCourierOpen(c.shiftId)}
              className="flex items-center gap-2 rounded-full bg-neutral-100 py-1 pl-1 pr-3 text-base text-neutral-600 active:scale-[.97]"
            >
              <Face name={c.name} src={photos[c.courierId]} small />
              {c.name} · {COURIER_STATE[c.state]}
            </button>
          ))}
        </div>
        {board.cashAlerts.map((a) => (
          <span key={a.id} className="rounded-lg bg-amber-400 px-3 py-1 text-base font-semibold text-amber-950">
            💵 {a.text}
          </span>
        ))}
        {offline && (
          <span className="rounded-lg bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            нет связи
          </span>
        )}
        <button
          onClick={() => setExtraOpen(true)}
          className="rounded-xl bg-amber-500 px-4 py-2 text-lg font-semibold text-white"
        >
          + Довоз
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 p-3">
          <Column title="Новый" hint="нажмите, когда пакет собран" count={fresh.length}>
            {fresh.map((t) =>
              t.kind === 'PICKUP' ? (
                <Tile key={t.id} task={t} nowMs={nowMs} onLongPress={() => setTaskOpen(t.id)}>
                  <TileButton onClick={() => act(t, 'ready')}>Готов</TileButton>
                  <TileButton tone="muted" onClick={() => act(t, 'handed-over')}>
                    Выдан
                  </TileButton>
                </Tile>
              ) : (
                <Tile key={t.id} task={t} nowMs={nowMs} onClick={() => act(t, 'ready')} onLongPress={() => setTaskOpen(t.id)} />
              ),
            )}
          </Column>
          <Column title="Готов" count={readyCol.length}>
            {readyCol.map((t) => (
              <Tile key={t.id} task={t} nowMs={nowMs} onLongPress={() => setTaskOpen(t.id)}>
                {t.kind === 'PICKUP' ? (
                  <TileButton onClick={() => act(t, 'handed-over')}>Выдан клиенту</TileButton>
                ) : t.courier ? (
                  <div className="text-xl font-bold text-emerald-700">
                    → {t.courier}
                    {t.batchSeq && (
                      <span className="ml-2 text-base font-semibold text-sky-700">
                        связка, {t.batchSeq === 1 ? 'везёт первым' : 'везёт вторым'}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-base text-amber-700">ждёт курьера</div>
                )}
              </Tile>
            ))}
          </Column>
          <Column title="В пути" count={onWay.length}>
            {onWay.map((t) => (
              <Tile key={t.id} task={t} nowMs={nowMs} onLongPress={() => setTaskOpen(t.id)}>
                <div className="text-lg font-semibold">
                  {t.courier}
                  {t.pickedUpAt && (
                    <span className="ml-2 font-normal text-neutral-500">
                      {minutes(t.pickedUpAt, nowMs)} мин в пути
                    </span>
                  )}
                </div>
              </Tile>
            ))}
          </Column>
        </div>

        <aside className="flex w-72 shrink-0 flex-col items-center border-l border-black/10 p-4 text-center">
          <div className="text-lg font-semibold">Курьер приехал?</div>
          <p className="mb-3 text-sm text-neutral-500">
            В боте нажмите «Я на месте» и наведите камеру
          </p>
          <div
            className="w-full rounded-xl bg-white p-2"
            // SVG от нашего же сервера (библиотека qrcode), не от пользователя
            dangerouslySetInnerHTML={{ __html: board.qr.svg }}
          />
          <p className="mt-2 text-xs text-neutral-400">код меняется каждые 10 секунд</p>

          {/* Кто отметился за последнюю минуту — рядом с QR, не поверх
              заказов: раздача видит, если «отметился» тот, кого у стойки нет */}
          {board.checkIns
            .filter((c, i, all) => all.findIndex((x) => x.name === c.name) === i)
            .map((c) => (
              <div
                key={c.id}
                className="mt-2 w-full rounded-xl bg-emerald-600 px-3 py-2 text-base font-semibold text-white"
              >
                {c.name} отметился
              </div>
            ))}

          {/* Закрытые за последние 5 минут — коротким списком: колонка под
              них отнимала бы место у живых заказов */}
          <div className="mt-4 flex min-h-0 w-full flex-1 flex-col text-left">
            <div className="mb-1 text-sm font-semibold text-neutral-500">
              Доставлено и выдано{done.length > 0 && ` · ${done.length}`}
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {done
                .slice()
                .reverse()
                .map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 text-sm">
                    <span className="font-bold tabular-nums">№{t.number}</span>
                    <span className="truncate text-neutral-500">
                      {t.status === 'FAILED'
                        ? 'не удалось доставить'
                        : t.status === 'HANDED_OVER'
                          ? 'выдан'
                          : `${t.kind === 'EXTRA_TRIP' ? 'довоз · ' : ''}${t.courier ?? 'доставлен'}`}
                    </span>
                    {t.doneAt && (
                      <span className="ml-auto text-xs text-neutral-400 tabular-nums">
                        {clock(t.doneAt)}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
          <div className="mt-2 text-xs text-neutral-400">{board.device.name}</div>
        </aside>
      </div>

      {taskOpen &&
        (() => {
          const t = board.tasks.find((x) => x.id === taskOpen);
          return t ? (
            <TaskDialog
              task={t}
              nowMs={nowMs}
              onClose={() => setTaskOpen(null)}
              onAction={async (a) => {
                setTaskOpen(null);
                await act(t, a);
              }}
            />
          ) : null;
        })()}

      {courierOpen &&
        (() => {
          const c = board.couriers.find((x) => x.shiftId === courierOpen);
          return c ? (
            <CourierDialog
              courier={c}
              photo={photos[c.courierId]}
              onClose={() => setCourierOpen(null)}
              onAction={(a) => courierAction(c.shiftId, a)}
            />
          ) : null;
        })()}

      {extraOpen && (
        <ExtraTripDialog onClose={() => setExtraOpen(false)} onCreate={createExtraTrip} />
      )}

      {(undo || error) && (
        <div className="fixed inset-x-0 bottom-4 flex justify-center px-4">
          {undo ? (
            <div className="flex items-center gap-4 rounded-2xl bg-neutral-900 px-5 py-3 text-lg text-white shadow-xl">
              №{undo.number} готов
              <button
                onClick={() => {
                  const t = board.tasks.find((x) => x.id === undo.id);
                  if (t) act(t, 'undo-ready');
                }}
                className="rounded-xl bg-white px-4 py-2 font-semibold text-neutral-900"
              >
                Отменить
              </button>
            </div>
          ) : (
            <button
              onClick={() => setError(null)}
              className="rounded-2xl bg-red-600 px-5 py-3 text-lg text-white shadow-xl"
            >
              {error}
            </button>
          )}
        </div>
      )}
    </Screen>
  );
}

const COURIER_STATE: Record<Courier['state'], string> = {
  WAITING: 'ждёт',
  ASSIGNED: 'идёт к раздаче',
  ON_DELIVERY: 'везёт',
  RETURNING: 'возвращается',
  ON_PAUSE: 'пауза',
  AWAY: 'вне смены',
};

function Screen({ children }: { children: React.ReactNode }) {
  // Поверх общей разметки админки: у планшета нет меню и отступов
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 text-neutral-900">{children}</div>
  );
}

function Column({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-black/[.04]">
      <h2 className="flex items-baseline gap-2 px-3 pb-1 pt-3">
        <span className="text-xl font-bold">{title}</span>
        <span className="text-lg text-neutral-400">{count}</span>
      </h2>
      {hint && <p className="px-3 pb-2 text-xs text-neutral-500">{hint}</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

/**
 * Долгое нажатие (полсекунды) — большая карточка заказа. Короткое
 * нажатие работает как раньше («Готов»). Сдвиг пальца отменяет долгое
 * нажатие: иначе прокрутка колонки открывала бы карточки.
 */
function useLongPress(onLongPress?: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    fired,
    handlers: onLongPress
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            fired.current = false;
            start.current = { x: e.clientX, y: e.clientY };
            clear();
            timer.current = window.setTimeout(() => {
              fired.current = true;
              onLongPress();
            }, 500);
          },
          onPointerMove: (e: React.PointerEvent) => {
            const s = start.current;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
          },
          onPointerUp: clear,
          onPointerLeave: clear,
          onPointerCancel: clear,
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            clear();
            fired.current = true;
            onLongPress();
          },
          // После долгого нажатия палец отпускают — это не «Готов»
          onClickCapture: (e: React.MouseEvent) => {
            if (fired.current) {
              e.stopPropagation();
              e.preventDefault();
              fired.current = false;
            }
          },
        }
      : {},
  };
}

function Tile({
  task,
  nowMs,
  onClick,
  onLongPress,
  faded,
  children,
}: {
  task: Task;
  nowMs: number;
  onClick?: () => void;
  onLongPress?: () => void;
  faded?: boolean;
  children?: React.ReactNode;
}) {
  const press = useLongPress(onLongPress);
  const preorder = task.scheduledAt && new Date(task.scheduledAt).getTime() > nowMs;
  const age = minutes(task.createdAt, nowMs);
  const ageTone = preorder
    ? 'text-neutral-500'
    : age >= 40
      ? 'text-red-600'
      : age >= 25
        ? 'text-amber-600'
        : 'text-emerald-700';
  const pickup = task.kind === 'PICKUP';

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-4xl font-black tabular-nums">№{task.number}</span>
        <span className={`text-lg font-semibold tabular-nums ${ageTone}`}>
          {preorder ? `к ${clock(task.scheduledAt!)}` : `${age} мин`}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs font-semibold uppercase">
        {task.external && (
          <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-yellow-950">старое прил.</span>
        )}
        {pickup && <span className="rounded bg-violet-600 px-1.5 py-0.5 text-white">самовывоз</span>}
        {task.kind === 'EXTRA_TRIP' && (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-white">довоз</span>
        )}
        {task.cash > 0 && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-white">нал {tenge(task.cash)}</span>
        )}
        {task.needsTerminal && (
          <span className="rounded bg-sky-600 px-1.5 py-0.5 text-white">терминал</span>
        )}
        {task.otherDepartments.map((d) => (
          <span key={d.name} className="rounded bg-teal-600 px-1.5 py-0.5 text-white">
            {d.only ? '' : '+ '}
            {d.name} · {d.count}
          </span>
        ))}
        {task.alert && (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-white">⚠ {ALERT_TEXT[task.alert]}</span>
        )}
      </div>
      {task.extraReason && (
        <div className="mt-1.5 text-base font-semibold text-amber-700">{task.extraReason}</div>
      )}
      <ul className="mt-1.5 space-y-0.5 text-base leading-snug">
        {task.items.map((i, idx) => (
          <li key={idx}>
            {i.qty > 1 && <b>{i.qty}× </b>}
            {i.name}
            {i.department && (
              <span className="ml-1 rounded bg-teal-100 px-1 text-xs font-semibold text-teal-800">
                {i.department}
              </span>
            )}
            {i.modifiers.length > 0 && (
              <span className="text-neutral-500"> · {i.modifiers.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
      {children && <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>}
    </>
  );

  // Цвет плитки: тревога → самовывоз → старое приложение → обычная
  const frame = `rounded-xl p-3 text-left shadow-sm ${
    task.alert
      ? 'bg-red-50 ring-2 ring-red-500'
      : pickup
        ? 'bg-violet-50 ring-2 ring-violet-300'
        : task.external
          ? 'bg-yellow-50 ring-2 ring-yellow-400'
          : 'bg-white'
  } ${faded ? 'opacity-60' : ''}`;

  // Без выделения текста и системного меню по долгому нажатию
  const noSelect = { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as const;
  return onClick ? (
    <button onClick={onClick} {...press.handlers} style={noSelect} className={`${frame} active:scale-[.98]`}>
      {body}
    </button>
  ) : (
    <div {...press.handlers} style={noSelect} className={frame}>
      {body}
    </div>
  );
}

const STATUS_TEXT: Record<TaskStatus, string> = {
  NEW: 'Новый — собирается',
  READY: 'Готов — ждёт курьера',
  ASSIGNED: 'Назначен курьеру',
  PICKED_UP: 'В пути',
  DELIVERED: 'Доставлен',
  HANDED_OVER: 'Выдан',
  FAILED: 'Не доставлен',
  CANCELLED: 'Отменён',
};

/** Большая карточка заказа: весь состав, адрес, телефон, оплата и действия */
function TaskDialog({
  task,
  nowMs,
  onClose,
  onAction,
}: {
  task: Task;
  nowMs: number;
  onClose: () => void;
  onAction: (a: 'ready' | 'handed-over' | 'cancel') => void;
}) {
  const d = task.details;
  const pickup = task.kind === 'PICKUP';
  const active = ['NEW', 'READY', 'ASSIGNED'].includes(task.status);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-full w-[640px] flex-col rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-5xl font-black tabular-nums">№{task.number}</span>
          <span className="text-lg text-neutral-500">
            {clock(task.createdAt)} · {minutes(task.createdAt, nowMs)} мин
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-xs font-semibold uppercase">
          {task.external && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-yellow-950">старое приложение</span>}
          {pickup && <span className="rounded bg-violet-600 px-1.5 py-0.5 text-white">самовывоз</span>}
          {task.kind === 'EXTRA_TRIP' && <span className="rounded bg-amber-500 px-1.5 py-0.5 text-white">довоз</span>}
          {task.otherDepartments.map((x) => (
            <span key={x.name} className="rounded bg-teal-600 px-1.5 py-0.5 text-white">
              {x.only ? '' : '+ '}
              {x.name} · {x.count}
            </span>
          ))}
        </div>
        <div className="mt-2 text-lg font-semibold">
          {STATUS_TEXT[task.status]}
          {task.courier && <span className="text-emerald-700"> → {task.courier}</span>}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {task.extraReason && <div className="mb-2 text-lg font-semibold text-amber-700">{task.extraReason}</div>}
          <ul className="space-y-1 text-xl leading-snug">
            {task.items.map((i, idx) => (
              <li key={idx}>
                {i.qty > 1 && <b>{i.qty}× </b>}
                {i.name}
                {i.department && (
                  <span className="ml-1 rounded bg-teal-100 px-1 text-sm font-semibold text-teal-800">{i.department}</span>
                )}
                {i.modifiers.length > 0 && <div className="text-base text-neutral-500">{i.modifiers.join(', ')}</div>}
              </li>
            ))}
          </ul>

          {d && (
            <dl className="mt-4 space-y-1.5 border-t border-black/10 pt-3 text-lg">
              {!pickup && (
                <div>
                  <dt className="text-sm text-neutral-500">Адрес</dt>
                  <dd>
                    {d.address ?? 'не указан'}
                    {d.addressComment && <div className="text-base text-neutral-500">{d.addressComment}</div>}
                  </dd>
                </div>
              )}
              {(d.customerName || d.phone) && (
                <div>
                  <dt className="text-sm text-neutral-500">Клиент</dt>
                  <dd>
                    {d.customerName}
                    {d.phone && (
                      <a href={`tel:${d.phone}`} className="ml-2 font-semibold text-sky-700">
                        {d.phone}
                      </a>
                    )}
                  </dd>
                </div>
              )}
              {d.comment && (
                <div>
                  <dt className="text-sm text-neutral-500">Комментарий</dt>
                  <dd className="whitespace-pre-line">{d.comment}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-neutral-500">Оплата</dt>
                <dd>{d.payment}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {task.status === 'NEW' && (
            <button onClick={() => onAction('ready')} className="rounded-xl bg-neutral-900 py-3 text-xl font-semibold text-white">
              Готов — пакет собран
            </button>
          )}
          {pickup && (task.status === 'NEW' || task.status === 'READY') && (
            <button onClick={() => onAction('handed-over')} className="rounded-xl bg-violet-600 py-3 text-xl font-semibold text-white">
              Выдан клиенту
            </button>
          )}
          {d?.cancellable && (
            <button
              onClick={() => {
                if (confirm(`Отменить заказ №${task.number}? Он исчезнет с планшета.`)) onAction('cancel');
              }}
              className="rounded-xl bg-red-50 py-3 text-lg font-semibold text-red-700"
            >
              Отменить заказ
            </button>
          )}
          {!task.external && active && task.kind !== 'EXTRA_TRIP' && (
            <p className="text-center text-sm text-neutral-500">
              Отменить наш заказ — через кассу: в Telegram «Действия» → «Отменить». Плитка уйдёт сама.
            </p>
          )}
          <button onClick={onClose} className="rounded-xl bg-neutral-100 py-3 text-lg">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function TileButton({
  onClick,
  tone = 'primary',
  children,
}: {
  onClick: () => void;
  tone?: 'primary' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-base font-semibold ${
        tone === 'primary' ? 'bg-neutral-900 text-white' : 'bg-black/5 text-neutral-700'
      }`}
    >
      {children}
    </button>
  );
}

function Face({ name, src, small }: { name: string; src?: string; small?: boolean }) {
  const size = small ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return src ? (
    <img src={src} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-white/70 font-bold`}>
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * Курьер в очереди: «Уехал» — например, повёз заказ из старого
 * приложения (временно, до перехода всех заказов в систему); «Закончил
 * смену» — ушёл и забыл закрыть её сам.
 */
function CourierDialog({
  courier,
  photo,
  onClose,
  onAction,
}: {
  courier: Courier;
  photo?: string;
  onClose: () => void;
  onAction: (a: 'away' | 'end-shift') => void;
}) {
  const away = courier.state === 'AWAY';
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[460px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-4">
          {photo ? (
            <img src={photo} alt="" className="h-24 w-24 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-neutral-100 text-4xl font-bold">
              {courier.name.slice(0, 1)}
            </div>
          )}
          <div>
            <div className="text-2xl font-bold">{courier.name}</div>
            <div className="text-lg text-neutral-500">{COURIER_STATE[courier.state]}</div>
          </div>
        </div>
        {courier.carrying ? (
          <p className="mb-4 text-lg text-neutral-600">
            Курьер везёт заказ. После доставки он сам вернётся в очередь сканом QR.
          </p>
        ) : (
          <div className="mb-3 flex flex-col gap-2">
            {!away && (
              <button
                onClick={() => onAction('away')}
                className="rounded-xl bg-amber-500 px-4 py-3 text-left text-white"
              >
                <span className="block text-xl font-semibold">Уехал</span>
                <span className="block text-sm opacity-90">
                  Убрать из очереди. Если заказ уже назначен, он сразу уйдёт следующему
                </span>
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`Закрыть смену: ${courier.name}? Расчёт придёт кассиру.`)) onAction('end-shift');
              }}
              className="rounded-xl bg-neutral-100 px-4 py-3 text-left"
            >
              <span className="block text-xl font-semibold">Закончил смену</span>
              <span className="block text-sm text-neutral-500">Ушёл и забыл закрыть смену сам</span>
            </button>
          </div>
        )}
        <button onClick={onClose} className="w-full rounded-xl bg-neutral-900 py-3 text-lg font-semibold text-white">
          Закрыть
        </button>
      </div>
    </div>
  );
}

const EXTRA_REASONS = ['Забыли позицию', 'Перепутали позицию', 'Не та добавка или соус'];

/**
 * Довоз по номеру заказа. Цифры крупными кнопками: у раздачи руки заняты,
 * а системная клавиатура на планшете закрывает пол-экрана.
 */
function ExtraTripDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (number: number, reason: string) => void;
}) {
  const [digits, setDigits] = useState('');
  const [reason, setReason] = useState(EXTRA_REASONS[0]);
  const [what, setWhat] = useState('');
  const number = Number(digits);
  const fullReason = what.trim() ? `${reason}: ${what.trim()}` : reason;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[560px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-2xl font-bold">Довоз к заказу</h2>
        <div className="mb-3 rounded-xl bg-neutral-100 px-4 py-3 text-4xl font-black tabular-nums">
          №{digits || <span className="text-neutral-300">___</span>}
        </div>
        <div className="mb-4 grid grid-cols-6 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
            <button
              key={d}
              onClick={() => setDigits((v) => (v + d).slice(0, 7))}
              className="rounded-xl bg-neutral-100 py-3 text-2xl font-bold"
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => setDigits((v) => v.slice(0, -1))}
            className="col-span-2 rounded-xl bg-neutral-100 py-3 text-xl"
          >
            ⌫
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {EXTRA_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`rounded-xl px-3 py-2 text-base ${
                reason === r ? 'bg-amber-500 text-white' : 'bg-neutral-100'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="Что везём (например: кола 1 л)"
          className="mb-4 w-full rounded-xl border border-black/10 px-3 py-2 text-lg"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-neutral-100 py-3 text-lg">
            Отмена
          </button>
          <button
            disabled={!number}
            onClick={() => onCreate(number, fullReason)}
            className="flex-1 rounded-xl bg-neutral-900 py-3 text-lg font-semibold text-white disabled:opacity-40"
          >
            Создать довоз
          </button>
        </div>
      </div>
    </div>
  );
}
