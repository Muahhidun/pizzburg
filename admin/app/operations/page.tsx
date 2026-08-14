'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AvailabilityNow,
  OrderingMode,
  ScheduleProfile,
  Settings,
  WEEKDAY_LABELS,
  WeekdayKey,
  api,
} from '@/lib/api';

/**
 * Режим работы: аварийный приём, расписание, предзаказы, оплата, отмена.
 * Всё, что решает «можно ли принять заказ прямо сейчас».
 */
export default function OperationsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setData(await api.get<Settings>('/admin/settings'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  const save = async (path: string, body: unknown, message = 'Сохранено') => {
    try {
      await api.patch(path, body);
      await load();
      flash(message);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  if (!data) return <p className="text-neutral-500">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Режим работы</h1>
        <p className="text-sm text-neutral-500">
          Приём заказов, расписание, предзаказы и оплата.
        </p>
      </div>

      <StatusBanner now={data.availabilityNow} />
      <OrderingCard settings={data} onSave={save} />
      <ScheduleCard settings={data} onSave={save} />
      <PreorderCard settings={data} onSave={save} />
      <PaymentsCard settings={data} onSave={save} />
      <CancellationCard settings={data} onSave={save} />

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-black">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Крупная плашка: что видит клиент прямо сейчас */
function StatusBanner({ now }: { now: AvailabilityNow }) {
  const bad = now.mode === 'CLOSED' || !now.isOpenNow;
  const warn = now.mode === 'PICKUP_ONLY';
  const tone = bad
    ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
    : warn
      ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
      : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';

  return (
    <section className={`rounded-2xl p-5 shadow-sm ${tone}`}>
      <div className="text-sm opacity-70">Сейчас в приложении</div>
      <div className="mt-0.5 text-xl font-bold">
        {now.mode === 'CLOSED'
          ? 'Приём заказов закрыт'
          : !now.isOpenNow
            ? 'Заведение закрыто по расписанию'
            : now.mode === 'PICKUP_ONLY'
              ? 'Только самовывоз'
              : 'Принимаем заказы'}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          Доставка:{' '}
          {now.deliveryAvailable
            ? now.isOpenNow
              ? 'да'
              : 'только предзаказ'
            : 'нет'}
        </span>
        <span>
          Самовывоз:{' '}
          {now.pickupAvailable
            ? now.isOpenNow
              ? 'да'
              : 'только предзаказ'
            : 'нет'}
        </span>
        <span>«Как можно быстрее»: {now.asapAvailable ? 'да' : 'нет'}</span>
        {now.scheduleProfile && <span>Профиль: {now.scheduleProfile}</span>}
        <span>
          Сегодня:{' '}
          {now.todayHours.length
            ? now.todayHours.map(([f, t]) => `${f}–${t}`).join(', ')
            : now.scheduleProfile
              ? 'выходной'
              : 'круглосуточно (расписание не задано)'}
        </span>
        <span className="opacity-60">Пояс: {now.timezone}</span>
      </div>
      {now.message && <div className="mt-2 text-sm font-medium">«{now.message}»</div>}
    </section>
  );
}

type SaveFn = (path: string, body: unknown, message?: string) => Promise<void>;

function OrderingCard({ settings, onSave }: { settings: Settings; onSave: SaveFn }) {
  const ordering = settings.settings.ordering ?? {};
  const [mode, setMode] = useState<OrderingMode>(ordering.mode ?? 'ALL');
  const [closedMessage, setClosedMessage] = useState(ordering.closedMessage ?? '');
  const [pickupMessage, setPickupMessage] = useState(ordering.pickupOnlyMessage ?? '');

  const options: { value: OrderingMode; title: string; hint: string }[] = [
    { value: 'ALL', title: 'Обычный режим', hint: 'Доставка и самовывоз' },
    {
      value: 'PICKUP_ONLY',
      title: 'Только самовывоз',
      hint: 'Когда нет курьеров',
    },
    { value: 'CLOSED', title: 'Приём закрыт', hint: 'Аварийная остановка' },
  ];

  return (
    <Card
      title="Приём заказов"
      hint="Аварийный рубильник. Действует поверх расписания."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setMode(o.value)}
            className={`rounded-xl border p-3 text-left transition ${
              mode === o.value
                ? 'border-black bg-black/[.03] dark:border-white dark:bg-white/10'
                : 'border-black/10 hover:bg-black/[.02] dark:border-white/15 dark:hover:bg-white/5'
            }`}
          >
            <div className="font-medium">{o.title}</div>
            <div className="text-xs text-neutral-500">{o.hint}</div>
          </button>
        ))}
      </div>

      {mode === 'CLOSED' && (
        <Field label="Что показать клиенту">
          <input
            value={closedMessage}
            onChange={(e) => setClosedMessage(e.target.value)}
            placeholder="Приём заказов временно приостановлен"
            className={inputClass}
          />
        </Field>
      )}
      {mode === 'PICKUP_ONLY' && (
        <Field label="Что показать клиенту">
          <input
            value={pickupMessage}
            onChange={(e) => setPickupMessage(e.target.value)}
            placeholder="Доставка временно недоступна — можно забрать самовывозом"
            className={inputClass}
          />
        </Field>
      )}

      <SaveButton
        onClick={() =>
          onSave('/admin/settings/ordering', {
            mode,
            closedMessage: closedMessage || undefined,
            pickupOnlyMessage: pickupMessage || undefined,
          })
        }
      />
    </Card>
  );
}

function ScheduleCard({ settings, onSave }: { settings: Settings; onSave: SaveFn }) {
  const [profiles, setProfiles] = useState<ScheduleProfile[]>(
    settings.settings.schedule?.profiles?.length
      ? settings.settings.schedule.profiles
      : [
          {
            id: 'base',
            name: 'Рабочее время',
            hours: Object.fromEntries(
              WEEKDAY_LABELS.map((d) => [d.key, [['10:00', '22:00']]]),
            ) as ScheduleProfile['hours'],
          },
        ],
  );

  const patchDay = (
    profileIndex: number,
    day: WeekdayKey,
    value: [string, string][] | null,
  ) => {
    setProfiles((prev) =>
      prev.map((p, i) =>
        i === profileIndex
          ? { ...p, hours: { ...p.hours, [day]: value ?? [] } }
          : p,
      ),
    );
  };

  const addProfile = () => {
    const id = `profile-${Date.now()}`;
    setProfiles((prev) => [
      ...prev,
      {
        id,
        name: 'Новый профиль',
        activeFrom: null,
        activeTo: null,
        hours: Object.fromEntries(
          WEEKDAY_LABELS.map((d) => [d.key, [['10:00', '22:00']]]),
        ) as ScheduleProfile['hours'],
      },
    ]);
  };

  return (
    <Card
      title="Расписание"
      hint="Профиль с датами (Рамадан, праздники) перекрывает основной на своём периоде."
    >
      <div className="space-y-4">
        {profiles.map((profile, pi) => (
          <div
            key={profile.id}
            className="rounded-xl border border-black/10 p-3 dark:border-white/15"
          >
            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
              <input
                value={profile.name}
                onChange={(e) =>
                  setProfiles((prev) =>
                    prev.map((p, i) =>
                      i === pi ? { ...p, name: e.target.value } : p,
                    ),
                  )
                }
                placeholder="Название профиля"
                className={inputClass}
              />
              <input
                type="date"
                value={profile.activeFrom ?? ''}
                onChange={(e) =>
                  setProfiles((prev) =>
                    prev.map((p, i) =>
                      i === pi ? { ...p, activeFrom: e.target.value || null } : p,
                    ),
                  )
                }
                className={inputClass}
              />
              <input
                type="date"
                value={profile.activeTo ?? ''}
                onChange={(e) =>
                  setProfiles((prev) =>
                    prev.map((p, i) =>
                      i === pi ? { ...p, activeTo: e.target.value || null } : p,
                    ),
                  )
                }
                className={inputClass}
              />
              {profiles.length > 1 && (
                <button
                  onClick={() =>
                    setProfiles((prev) => prev.filter((_, i) => i !== pi))
                  }
                  className="rounded-xl border border-black/10 px-3 text-sm text-red-600 dark:border-white/15"
                >
                  Удалить
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {WEEKDAY_LABELS.map((day) => {
                const intervals = profile.hours[day.key] ?? [];
                const closed = intervals.length === 0;
                return (
                  <div key={day.key} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 text-neutral-500">
                      {day.label}
                    </span>
                    {closed ? (
                      <>
                        <span className="flex-1 text-neutral-400">Выходной</span>
                        <button
                          onClick={() => patchDay(pi, day.key, [['10:00', '22:00']])}
                          className="text-xs text-blue-600"
                        >
                          открыть
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="time"
                          value={intervals[0][0]}
                          onChange={(e) =>
                            patchDay(pi, day.key, [
                              [e.target.value, intervals[0][1]],
                            ])
                          }
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
                        />
                        <span className="text-neutral-400">–</span>
                        <input
                          type="time"
                          value={intervals[0][1]}
                          onChange={(e) =>
                            patchDay(pi, day.key, [
                              [intervals[0][0], e.target.value],
                            ])
                          }
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
                        />
                        <button
                          onClick={() => patchDay(pi, day.key, [])}
                          className="ml-auto text-xs text-neutral-400 hover:text-red-600"
                        >
                          выходной
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <SaveButton
          onClick={() =>
            onSave('/admin/settings/schedule', {
              timezone: settings.settings.timezone,
              profiles,
            })
          }
        />
        <button
          onClick={addProfile}
          className="rounded-xl border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          + Профиль
        </button>
      </div>
    </Card>
  );
}

function PreorderCard({ settings, onSave }: { settings: Settings; onSave: SaveFn }) {
  const p = settings.availabilityNow.preorder;
  const [form, setForm] = useState({ ...p });

  const numbers: { key: keyof typeof form; label: string; hint: string }[] = [
    {
      key: 'deliveryLeadMinutes',
      label: 'Доставка через, мин',
      hint: 'Ближайшее доступное время',
    },
    { key: 'pickupLeadMinutes', label: 'Самовывоз через, мин', hint: '' },
    { key: 'slotStepMinutes', label: 'Шаг слотов, мин', hint: '' },
    {
      key: 'displayPaddingMinutes',
      label: 'Интервал клиенту, мин',
      hint: '«12:00–12:15»',
    },
    {
      key: 'closeAsapBeforeMinutes',
      label: 'Стоп «побыстрее» за, мин',
      hint: 'До закрытия',
    },
    { key: 'maxDaysAhead', label: 'Дней вперёд', hint: '' },
  ];

  return (
    <Card title="Предзаказы" hint="Когда клиент может выбрать время.">
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Разрешить предзаказ (в том числе когда закрыто)
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {numbers.map((n) => (
          <label key={n.key}>
            <span className="mb-1 block text-sm font-medium">{n.label}</span>
            <input
              type="number"
              value={String(form[n.key])}
              onChange={(e) =>
                setForm({ ...form, [n.key]: Number(e.target.value) })
              }
              className={inputClass}
            />
            {n.hint && (
              <span className="mt-0.5 block text-xs text-neutral-400">{n.hint}</span>
            )}
          </label>
        ))}
      </div>
      <SaveButton onClick={() => onSave('/admin/settings/preorder', form)} />
    </Card>
  );
}

function PaymentsCard({ settings, onSave }: { settings: Settings; onSave: SaveFn }) {
  const p = settings.availabilityNow.payments;
  const [form, setForm] = useState({ ...p });

  const toggles: { key: keyof typeof form; label: string; hint?: string }[] = [
    { key: 'cash', label: 'Наличными' },
    { key: 'cardOnDelivery', label: 'Картой курьеру', hint: 'Курьер берёт терминал' },
    { key: 'kaspiOnline', label: 'Kaspi онлайн', hint: 'Пока не подключён' },
    {
      key: 'askChangeFrom',
      label: 'Спрашивать сдачу',
      hint: 'С какой суммы готовить размен',
    },
  ];

  return (
    <Card title="Оплата" hint="Выключенный способ не пройдёт и на сервере.">
      <div className="space-y-1.5">
        {toggles.map((t) => (
          <label
            key={t.key}
            className="flex items-center gap-3 rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5"
          >
            <input
              type="checkbox"
              checked={Boolean(form[t.key])}
              disabled={t.key === 'kaspiOnline'}
              onChange={(e) => setForm({ ...form, [t.key]: e.target.checked })}
            />
            <span className="flex-1">
              {t.label}
              {t.hint && (
                <span className="ml-2 text-xs text-neutral-400">{t.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <SaveButton onClick={() => onSave('/admin/settings/payments', form)} />
    </Card>
  );
}

function CancellationCard({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: SaveFn;
}) {
  const [minutes, setMinutes] = useState(
    settings.availabilityNow.cancellation.customerWindowMinutes,
  );

  return (
    <Card
      title="Отмена клиентом"
      hint="Сколько минут после оформления клиент может отменить сам. 0 — только через оператора. Отмена доступна, пока кассир не принял заказ."
    >
      <label className="block max-w-[220px]">
        <span className="mb-1 block text-sm font-medium">Окно отмены, минут</span>
        <input
          type="number"
          min={0}
          max={120}
          value={String(minutes)}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className={inputClass}
        />
      </label>
      <SaveButton
        onClick={() =>
          onSave('/admin/settings/cancellation', { customerWindowMinutes: minutes })
        }
      />
    </Card>
  );
}

const inputClass =
  'w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15';

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-neutral-500">{hint}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
    >
      Сохранить
    </button>
  );
}
