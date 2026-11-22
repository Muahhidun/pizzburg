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
 */

interface Task {
  id: string;
  kind: 'DELIVERY' | 'PICKUP' | 'EXTRA_TRIP';
  status: 'ASSIGNED' | 'PICKED_UP';
  number: number;
  items: string;
  payment: string;
  cash: number;
  needsTerminal: boolean;
  assignedAt: string | null;
  pickedUpAt: string | null;
  extraReason: string | null;
  address?: string | null;
  addressComment?: string | null;
  mapUrl?: string | null;
  phone?: string | null;
  customerName?: string | null;
  comment?: string | null;
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
  today: { deliveries: number; earned: number };
  cash: {
    balance: number;
    pendingHandover: { amount: number; createdAt: string } | null;
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
  const [busy, setBusy] = useState(false);
  const [failFor, setFailFor] = useState<Task | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tenant = useRef('');

  // SDK Telegram подключаем сами: страница живёт в общей админке
  useEffect(() => {
    tenant.current = new URLSearchParams(window.location.search).get('t') ?? '';
    const done = () => {
      const app = tg();
      app?.ready();
      app?.expand();
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
    app.showScanQrPopup({ text: 'Наведите камеру на QR на планшете раздачи' }, (text: string) => {
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

      {me.courier.status === 'PENDING' && (
        <Card tone="warn">
          <b>Заявка ждёт проверки.</b> Отсканируйте QR у раздачи и покажите кассиру
          удостоверение: она подтвердит вас, и начнут приходить заказы.
        </Card>
      )}

      {onWay.map((t) => (
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
              <a href={`tel:${t.phone}`} className="btn-secondary">
                Позвонить{t.customerName ? ` · ${t.customerName}` : ''}
              </a>
            )}
            {t.mapUrl && (
              <a href={t.mapUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                Открыть в 2ГИС
              </a>
            )}
          </div>
          <button disabled={busy} onClick={() => delivered(t)} className="btn-primary mt-3">
            Доставлен
          </button>
          <button disabled={busy} onClick={() => setFailFor(t)} className="btn-link mt-2">
            Не удалось доставить
          </button>
        </Card>
      ))}

      {assigned.map((t) => {
        const left = t.assignedAt
          ? me.pickupTimeoutMin * 60 -
            Math.floor((nowMs - new Date(t.assignedAt).getTime()) / 1000)
          : null;
        return (
          <Card key={t.id} tone="accent">
            <div className="text-sm font-semibold uppercase opacity-70">
              {t.kind === 'EXTRA_TRIP' ? 'Довоз' : 'Заберите на раздаче'}
            </div>
            <div className="text-4xl font-black">№{t.number}</div>
            <div className="mt-1 text-lg">{t.items}</div>
            <div className="mt-1 font-semibold">{t.payment}</div>
            {left !== null && left > 0 && (
              <div className="mt-1 text-sm opacity-70">
                отметьте «Забрал» в течение {Math.ceil(left / 60)} мин
              </div>
            )}
            <button
              disabled={busy}
              onClick={() => scan((qr) => act(`/tasks/${t.id}/picked-up`, { qr }))}
              className="btn-primary mt-3"
            >
              Забрал — сканировать QR
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('Отметить без скана? Доставка засчитается с пометкой.')) {
                  act(`/tasks/${t.id}/picked-up-manual`);
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

      {!me.cash.settlement && (me.cash.balance > 0 || me.cash.pendingHandover) && (
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
