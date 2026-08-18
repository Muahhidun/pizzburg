'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings, TelegramSettings, api, formatTenge } from '@/lib/api';

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [minOrder, setMinOrder] = useState('');
  const [fee, setFee] = useState('');
  const [freeFrom, setFreeFrom] = useState('');
  const [cashbackPct, setCashbackPct] = useState('3');
  const [earnWhenPointsSpent, setEarnWhenPointsSpent] = useState(false);
  const [allowPointsWithPromotions, setAllowPointsWithPromotions] = useState(false);
  const [earnOnPromotionalOrders, setEarnOnPromotionalOrders] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const d = await api.get<Settings>('/admin/settings');
    setData(d);
    setMinOrder(String(d.settings.delivery?.minOrder ?? 0));
    setFee(String(d.settings.delivery?.fee ?? 0));
    setFreeFrom(String(d.settings.delivery?.freeFrom ?? 0));
    setCashbackPct(String(d.settings.loyalty?.cashbackPct ?? 3));
    setEarnWhenPointsSpent(d.settings.loyalty?.earnWhenPointsSpent === true);
    setAllowPointsWithPromotions(d.settings.loyalty?.allowPointsWithPromotions === true);
    setEarnOnPromotionalOrders(d.settings.loyalty?.earnOnPromotionalOrders === true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deliveryValid =
    [minOrder, fee, freeFrom].every(
      (value) => /^\d+$/.test(value) && Number(value) <= 100_000_000,
    ) &&
    (Number(freeFrom) === 0 || Number(minOrder) === 0 || Number(freeFrom) >= Number(minOrder));

  async function saveDelivery() {
    if (!deliveryValid) return;
    await api.patch('/admin/settings', {
      minOrder: Number(minOrder),
      fee: Number(fee),
      freeFrom: Number(freeFrom),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const loyaltyValid = /^\d+$/.test(cashbackPct) && Number(cashbackPct) <= 100;

  async function saveLoyalty() {
    if (!loyaltyValid) return;
    await api.patch('/admin/settings', {
      cashbackPct: Number(cashbackPct),
      earnWhenPointsSpent,
      allowPointsWithPromotions,
      earnOnPromotionalOrders,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!data) return <p className="text-neutral-500">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Настройки</h1>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">Доставка</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Ниже минимальной суммы клиенту доступен только самовывоз.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className="mb-1 block text-sm font-medium">Минимальный заказ, ₸</span>
            <input
              type="number"
              min={0}
              max={100000000}
              step={1}
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Стоимость доставки, ₸</span>
            <input
              type="number"
              min={0}
              max={100000000}
              step={1}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Бесплатно от, ₸</span>
            <input
              type="number"
              min={0}
              max={100000000}
              step={1}
              value={freeFrom}
              onChange={(e) => setFreeFrom(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveDelivery}
            disabled={!deliveryValid}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Сохранить
          </button>
          {saved && <span className="text-sm text-emerald-600">Сохранено</span>}
        </div>
        {!deliveryValid && (
          <p className="mt-2 text-sm text-red-600">
            Все суммы должны быть целыми и неотрицательными; бесплатная доставка не может начинаться
            ниже минимального заказа.
          </p>
        )}
        <p className="mt-3 text-xs text-neutral-400">
          Сейчас: заказ от {formatTenge(Number(minOrder))}, доставка {formatTenge(Number(fee))},
          бесплатно от {formatTenge(Number(freeFrom))}
        </p>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-1 font-semibold">Кэшбэк приложения</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Начисляется после статуса «Доставлен». Бонусы Poster, включая их 7%, здесь не
          используются.
        </p>
        <div className="flex max-w-sm items-end gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">Кэшбэк, %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={cashbackPct}
              onChange={(e) => setCashbackPct(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>
          <button
            onClick={saveLoyalty}
            disabled={!loyaltyValid}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Сохранить
          </button>
        </div>
        <div className="mt-5 space-y-3">
          <PolicyToggle
            checked={earnWhenPointsSpent}
            onChange={setEarnWhenPointsSpent}
            title="Начислять кэшбэк, если заказ частично оплачен баллами"
            description="Выключено: любое списание баллов отменяет начисление кэшбэка за этот заказ."
          />
          <PolicyToggle
            checked={allowPointsWithPromotions}
            onChange={setAllowPointsWithPromotions}
            title="Разрешать использовать баллы вместе с акциями"
            description="Выключено: клиент выбирает либо подарок/скидку по акции, либо оплату баллами."
          />
          <PolicyToggle
            checked={earnOnPromotionalOrders}
            onChange={setEarnOnPromotionalOrders}
            title="Начислять кэшбэк за заказы с акциями"
            description="Выключено: за заказ с подарком или скидкой новый кэшбэк не начисляется."
          />
        </div>
        {!loyaltyValid && (
          <p className="mt-2 text-sm text-red-600">Укажите целое число от 0 до 100.</p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Отделы (аккаунты Poster)</h2>
            <p className="text-sm text-neutral-500">
              Меню всех отделов сливается в одно; заказ расщепляется по планшетам.
            </p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="shrink-0 rounded-xl border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
          >
            + Отдел
          </button>
        </div>
        <ul className="space-y-1.5">
          {data.posterAccounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5"
            >
              <span className="text-sm text-neutral-400">{a.sortOrder}</span>
              <span className="flex-1 font-medium">{a.name}</span>
              <span className={`text-xs ${a.isActive ? 'text-emerald-600' : 'text-neutral-400'}`}>
                {a.isActive ? 'активен' : 'выключен'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-neutral-400">
          Первый по порядку — «главный»: по нему клиенту уходит уведомление о принятии общего
          заказа.
        </p>
      </section>

      <TelegramSection />

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-3 font-semibold">Точки</h2>
        <ul className="space-y-1.5">
          {data.venues.map((v) => (
            <li key={v.id} className="rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5">
              <div className="font-medium">{v.name}</div>
              <div className="text-sm text-neutral-500">{v.address}</div>
            </li>
          ))}
        </ul>
      </section>

      {adding && (
        <AddAccount
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function PolicyToggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 p-3 dark:border-white/15">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-black dark:accent-white"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{description}</span>
      </span>
    </label>
  );
}

function AddAccount({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [sortOrder, setSortOrder] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 80 &&
    token.trim().length >= 10 &&
    token.trim().length <= 500 &&
    /^\d+$/.test(sortOrder) &&
    Number(sortOrder) <= 1000;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/poster-accounts', {
        name,
        token: token.trim(),
        sortOrder: Number(sortOrder),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить токен');
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
        className="w-full max-w-md rounded-t-2xl bg-white p-5 dark:bg-neutral-900 sm:rounded-2xl"
      >
        <h2 className="mb-1 text-lg font-semibold">Новый отдел</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Токен берётся в админке Poster: Настройки → API. Он не отображается после сохранения.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Название</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Например: Sunday"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Токен Poster API</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            minLength={10}
            maxLength={500}
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 font-mono dark:border-white/15"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">Порядок</span>
          <input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || !valid}
            className="flex-1 rounded-xl bg-black py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? 'Сохраняем…' : 'Добавить'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-black/10 px-4 py-2.5 dark:border-white/15"
          >
            Отмена
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}


/**
 * Телеграм как канал руководства (DECISIONS §12.7).
 *
 * Токен живёт в настройках арендатора, а не в переменных окружения:
 * владелец меняет бота из админки, без деплоя. Обратно форме токен не
 * отдаётся — только хвост, чтобы сверить, что вставлен нужный.
 */
function TelegramSection() {
  const [state, setState] = useState<TelegramSettings | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await api.get<TelegramSettings>('/admin/settings/telegram');
    setState(s);
    setChatId(s.chatId);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(what: string, fn: () => Promise<string | null>) {
    setBusy(what);
    setError(null);
    setNote(null);
    try {
      setNote(await fn());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!state) return null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
      <h2 className="mb-1 font-semibold">Телеграм для руководства</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Сюда приходят стоп-листы, нехватка позиций и другие события, о которых
        иначе узнаёшь, только если сам откроешь админку. Кассиры этим ботом не
        пользуются.
      </p>

      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-neutral-500">
        <li>Создайте бота у @BotFather и скопируйте токен.</li>
        <li>Вставьте токен ниже и сохраните.</li>
        <li>
          Откройте бота по прямой ссылке, нажмите «Запустить» и напишите ему
          любое сообщение — без этого телеграм не даёт боту писать первым.
        </li>
        <li>Нажмите «Определить чат» — id подставится сам.</li>
        <li>Включите канал и проверьте связь.</li>
      </ol>

      {/* Поле токена показывает точки, и кажется, что он уже сохранён.
          Пока сервер не подтвердил, говорим об этом прямо. */}
      {!state.botTokenSet && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Токен ещё не сохранён — вставьте его и нажмите «Сохранить».
          {state.enabled && ' Пока токена нет, уведомления не отправляются.'}
        </p>
      )}

      <label className="block text-sm">
        Токен бота
        {state.botTokenSet && (
          <span className="ml-2 text-xs text-emerald-600">
            задан {state.botTokenHint}
          </span>
        )}
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder={state.botTokenSet ? 'оставьте пустым, чтобы не менять' : '123456:AA…'}
          className="mt-1 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
        />
      </label>

      <label className="mt-3 block text-sm">
        Чат
        <input
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          className="mt-1 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) =>
            run('toggle', async () => {
              await api.patch('/admin/settings/telegram', {
                enabled: e.target.checked,
              });
              return e.target.checked ? 'Канал включён' : 'Канал выключен';
            })
          }
        />
        Отправлять уведомления
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() =>
            run('save', async () => {
              await api.patch('/admin/settings/telegram', {
                ...(token.trim() ? { botToken: token.trim() } : {}),
                chatId: chatId.trim(),
              });
              setToken('');
              return 'Сохранено';
            })
          }
          disabled={busy !== null}
          className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy === 'save' ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button
          onClick={() =>
            run('detect', async () => {
              const res = await api.post<{ chatId: string; title: string }>(
                '/admin/settings/telegram/detect-chat',
              );
              setChatId(res.chatId);
              return `Нашёл чат ${res.title || res.chatId} — нажмите «Сохранить»`;
            })
          }
          disabled={busy !== null}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
        >
          {busy === 'detect' ? 'Ищем…' : 'Определить чат'}
        </button>
        <button
          onClick={() =>
            run('test', async () => {
              await api.post('/admin/settings/telegram/test');
              return 'Сообщение отправлено — проверьте телеграм';
            })
          }
          disabled={busy !== null}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
        >
          {busy === 'test' ? 'Отправляем…' : 'Проверить связь'}
        </button>
      </div>

      {note && <p className="mt-3 text-sm text-emerald-600">{note}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
