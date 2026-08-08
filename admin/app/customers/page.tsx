'use client';

import { useCallback, useEffect, useState } from 'react';
import { CustomerRow, CustomersResponse, api, formatTenge } from '@/lib/api';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [open, setOpen] = useState<CustomerRow | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page) });
    if (search.trim()) q.set('search', search.trim());
    setData(await api.get<CustomersResponse>(`/admin/customers?${q}`));
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(load, 250); // дебаунс поиска
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <p className="text-sm text-neutral-500">
            {data ? `${data.total.toLocaleString('ru-RU')} в базе` : 'Загрузка…'}
          </p>
        </div>
        <input
          value={search}
          maxLength={120}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Поиск по имени или телефону"
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15 sm:w-72"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm dark:bg-neutral-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-black/5 text-left text-neutral-500 dark:border-white/10">
            <tr>
              <th className="p-3 font-medium">Клиент</th>
              <th className="p-3 font-medium">Заказов</th>
              <th className="p-3 font-medium">Сумма</th>
              <th className="p-3 font-medium">Средний чек</th>
              <th className="p-3 font-medium">Баллы</th>
              <th className="p-3 font-medium">Последний заказ</th>
            </tr>
          </thead>
          <tbody>
            {data?.customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => setOpen(c)}
                className="cursor-pointer border-b border-black/5 last:border-0 hover:bg-black/[.02] dark:border-white/5 dark:hover:bg-white/5"
              >
                <td className="p-3">
                  <div className="font-medium">{c.name ?? 'Без имени'}</div>
                  <div className="text-neutral-500">{c.phone}</div>
                </td>
                <td className="p-3">{c.ordersCount}</td>
                <td className="p-3">{formatTenge(c.totalSpent)}</td>
                <td className="p-3">{formatTenge(c.averageCheck)}</td>
                <td className="p-3">{c.pointsBalance}</td>
                <td className="p-3 text-neutral-500">
                  {c.lastOrderAt
                    ? new Date(c.lastOrderAt).toLocaleDateString('ru-RU')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.customers.length === 0 && (
          <p className="p-8 text-center text-neutral-500">Никого не нашлось</p>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40 dark:border-white/15"
          >
            ←
          </button>
          <span className="text-neutral-500">
            {page} из {data.pages}
          </span>
          <button
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40 dark:border-white/15"
          >
            →
          </button>
        </div>
      )}

      {open && <CustomerCard customer={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

interface CustomerDetails {
  id: string;
  name: string | null;
  phone: string;
  pointsBalance: number;
  loyaltyTxns: {
    id: string;
    type: 'EARN' | 'SPEND' | 'ADJUST';
    amount: number;
    comment: string;
    createdAt: string;
  }[];
  orders: {
    id: string;
    number: number;
    createdAt: string;
    total: number;
    status: string;
    items: { name: string; qty: number; isGift: boolean }[];
  }[];
}

function CustomerCard({
  customer,
  onClose,
}: {
  customer: CustomerRow;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(() => {
    api.get<CustomerDetails>(`/admin/customers/${customer.id}`).then(setDetails);
  }, [customer.id]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const adjustmentValid =
    /^-?\d+$/.test(amount) &&
    Number(amount) !== 0 &&
    Math.abs(Number(amount)) <= 10_000_000 &&
    comment.trim().length >= 3;

  async function adjust() {
    if (!adjustmentValid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/customers/${customer.id}/loyalty-adjust`, {
        amount: Number(amount),
        comment: comment.trim(),
      });
      setAmount('');
      setComment('');
      loadDetails();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить баланс');
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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-neutral-900 sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold">{customer.name ?? 'Без имени'}</h2>
        <p className="text-sm text-neutral-500">{customer.phone}</p>

        <div className="my-4 grid grid-cols-3 gap-2 text-center">
          <Mini label="Заказов" value={String(customer.ordersCount)} />
          <Mini label="Потратил" value={formatTenge(customer.totalSpent)} />
          <Mini label="Баллы" value={String(details?.pointsBalance ?? customer.pointsBalance)} />
        </div>

        <div className="mb-4 rounded-xl bg-black/[.03] p-3 dark:bg-white/5">
          <h3 className="mb-2 font-medium">Корректировка баланса</h3>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
            <input
              type="number"
              step={1}
              min={-10000000}
              max={10000000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="+100 / −100"
              className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
            />
            <input
              value={comment}
              maxLength={300}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Причина корректировки"
              className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
            />
          </div>
          <button
            onClick={adjust}
            disabled={!adjustmentValid || busy}
            className="mt-2 rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? 'Сохраняем…' : 'Применить'}
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <h3 className="mb-2 font-medium">Журнал баллов</h3>
        <ul className="mb-4 space-y-1.5">
          {details?.loyaltyTxns.map((txn) => (
            <li key={txn.id} className="flex items-start justify-between gap-3 rounded-lg bg-black/[.03] px-3 py-2 text-sm dark:bg-white/5">
              <div>
                <div>{txn.comment}</div>
                <div className="text-xs text-neutral-500">
                  {new Date(txn.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <span className={txn.amount > 0 ? 'text-emerald-600' : 'text-red-600'}>
                {txn.amount > 0 ? '+' : ''}{txn.amount}
              </span>
            </li>
          ))}
          {details?.loyaltyTxns.length === 0 && (
            <li className="text-sm text-neutral-500">Операций ещё не было</li>
          )}
        </ul>

        <h3 className="mb-2 font-medium">История заказов</h3>
        {!details && <p className="text-sm text-neutral-500">Загрузка…</p>}
        <ul className="space-y-2">
          {details?.orders.map((o) => (
            <li key={o.id} className="rounded-xl bg-black/[.03] p-3 text-sm dark:bg-white/5">
              <div className="flex justify-between">
                <span className="font-medium">№{o.number}</span>
                <span>{formatTenge(o.total)}</span>
              </div>
              <div className="text-neutral-500">
                {new Date(o.createdAt).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · {o.items.map((i) => `${i.name}×${i.qty}`).join(', ')}
              </div>
            </li>
          ))}
          {details?.orders.length === 0 && (
            <li className="text-sm text-neutral-500">Заказов ещё не было</li>
          )}
        </ul>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-black/10 py-2.5 dark:border-white/15"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[.03] p-2.5 dark:bg-white/5">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
