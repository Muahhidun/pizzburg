'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AddressRequestRow,
  AddressesResponse,
  api,
  CityAddress,
} from '@/lib/api';

/**
 * Адресный справочник города.
 *
 * Свой справочник, а не внешний сервис: оформление заказа не должно падать
 * вместе с чужим API. Заодно он работает зоной доставки — адрес, помеченный
 * «не возим», остаётся в базе, но в приложении не предлагается.
 *
 * Удаления здесь нет намеренно: следующий импорт из OpenStreetMap вернул бы
 * удалённый адрес обратно, и оператор удалял бы его снова каждую выгрузку.
 *
 * Заявки «моего адреса нет» стоят на этой же странице: их заводят ради того,
 * чтобы добавить адрес, и делать это нужно там же, где смотришь.
 */
export default function AddressesPage() {
  const [data, setData] = useState<AddressesResponse | null>(null);
  const [requests, setRequests] = useState<AddressRequestRow[] | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setData(
      await api.get<AddressesResponse>(
        `/admin/addresses?q=${encodeURIComponent(q)}&page=${page}`,
      ),
    );
  }, [q, page]);

  const loadRequests = useCallback(async () => {
    setRequests(await api.get<AddressRequestRow[]>('/admin/address-requests'));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => {
    loadRequests().catch(() => setRequests([]));
  }, [loadRequests]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await Promise.all([load(), loadRequests()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      await api.post('/admin/addresses', {
        street: street.trim(),
        house: house.trim(),
      });
      setHouse('');
    });

  const toggle = (a: CityAddress) =>
    run(() =>
      api.patch(`/admin/addresses/${a.id}`, { isDeliverable: !a.isDeliverable }),
    );

  const input =
    'rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-800';

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold">Адреса города</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-500">
        Клиент выбирает адрес только отсюда — произвольную строку в приложении
        ввести нельзя. Данные — OpenStreetMap, обновляются импортом.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">
          {error}
        </p>
      )}

      {requests !== null && requests.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-lg font-semibold">
            Клиенты не нашли свой адрес ({requests.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            Заказ у них прошёл, адрес оператор проверяет вручную. Если адрес
            настоящий — добавьте его ниже, и следующему клиенту он уже
            предложится.
          </p>
          <div className="mt-3 space-y-2">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-black/20"
              >
                <span className="font-medium">{r.raw}</span>
                <span className="text-neutral-500">
                  {r.customer?.phone ?? r.phone ?? 'без телефона'} ·{' '}
                  {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                </span>
                <button
                  onClick={() =>
                    run(() =>
                      api.post(`/admin/address-requests/${r.id}/resolve`),
                    )
                  }
                  disabled={busy}
                  className="ml-auto rounded-lg px-3 py-1 text-sm text-neutral-600 hover:bg-black/5 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/10"
                >
                  Разобрался
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-lg font-semibold">Добавить адрес</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="улица Абая"
            className={`${input} min-w-56 flex-1`}
          />
          <input
            value={house}
            onChange={(e) => setHouse(e.target.value)}
            placeholder="38А"
            className={`${input} w-28`}
          />
          <button
            onClick={add}
            disabled={busy || street.trim().length < 2 || !house.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Добавить
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Написание улицы подтянется к уже существующему в справочнике — иначе
          одна улица раздвоится в подсказках у клиента.
        </p>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Поиск по улице или дому"
          className={`${input} min-w-64 flex-1`}
        />
        {data && (
          <span className="text-sm text-neutral-500">
            Всего {data.totalAll.toLocaleString('ru-RU')}
            {data.undeliverable > 0 && ` · не возим: ${data.undeliverable}`}
          </span>
        )}
      </div>

      {data === null ? (
        <p className="mt-6 text-sm text-neutral-500">Загружаем…</p>
      ) : data.items.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">Ничего не нашлось</p>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
            {data.items.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-3 border-b border-black/5 px-4 py-2.5 text-sm last:border-0 dark:border-white/10 ${
                  a.isDeliverable ? '' : 'opacity-50'
                }`}
              >
                <span className="font-medium">
                  {a.street}, {a.house}
                </span>
                {a.source === 'MANUAL' && (
                  <span className="rounded-md bg-black/5 px-2 py-0.5 text-xs text-neutral-500 dark:bg-white/10">
                    заведён вручную
                  </span>
                )}
                {a.lat == null && (
                  <span className="text-xs text-neutral-400">
                    без координат
                  </span>
                )}
                <button
                  onClick={() => toggle(a)}
                  disabled={busy}
                  className="ml-auto rounded-lg px-3 py-1 text-sm text-neutral-500 hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
                >
                  {a.isDeliverable ? 'Не возим сюда' : 'Вернуть в доставку'}
                </button>
              </div>
            ))}
          </div>

          {data.pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/15"
              >
                Назад
              </button>
              <span className="text-sm text-neutral-500">
                {page} из {data.pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page >= data.pages}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/15"
              >
                Вперёд
              </button>
            </div>
          )}
        </>
      )}

      <p className="mt-8 text-xs text-neutral-400">
        Данные адресов © участники OpenStreetMap, лицензия ODbL.
      </p>
    </main>
  );
}
