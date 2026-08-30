'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuditRow { id: string; actorName: string; actorRole: 'OWNER' | 'CASHIER'; action: string; summary: string; createdAt: string; }

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get<AuditRow[]>('/admin/audit').then(setRows).catch((e) => setError((e as Error).message)); }, []);
  return <div>
    <h1 className="text-2xl font-bold">Журнал действий</h1>
    <p className="mb-5 mt-1 text-sm text-neutral-500">Кто и когда менял заказы, стопы, режим работы и доступы.</p>
    {error && <p className="text-sm text-red-600">{error}</p>}
    {!rows && !error && <p className="text-neutral-500">Загрузка…</p>}
    <ul className="space-y-2">{rows?.map((row) => <li key={row.id} className="rounded-xl bg-white p-3 shadow-sm dark:bg-neutral-900"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{row.actorName}</b><span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/10">{row.actorRole === 'CASHIER' ? 'кассир' : 'владелец'}</span><time className="ml-auto text-xs text-neutral-400">{new Date(row.createdAt).toLocaleString('ru-RU')}</time></div><p className="mt-1 text-sm">{row.summary}</p></li>)}</ul>
    {rows?.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-neutral-500 dark:bg-neutral-900">Действий пока нет</p>}
  </div>;
}
