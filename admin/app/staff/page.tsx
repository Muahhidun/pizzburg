'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminProfile, api } from '@/lib/api';

export default function StaffPage() {
  const [staff, setStaff] = useState<AdminProfile[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'CASHIER' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get<AdminProfile[]>('/admin/staff').then(setStaff), []);

  useEffect(() => { load().catch((e) => setError((e as Error).message)); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post('/admin/staff', form);
      setForm({ username: '', displayName: '', password: '', role: 'CASHIER' });
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold">Сотрудники</h1><p className="text-sm text-neutral-500">У каждого свой логин. Отключение сразу закрывает все его сессии, но сохраняет историю действий.</p></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form onSubmit={create} className="grid gap-3 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2 dark:bg-neutral-900">
        <h2 className="font-semibold md:col-span-2">Новый сотрудник</h2>
        <input className={input} placeholder="Имя, например Айгуль" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <input className={input} placeholder="Логин: aigul" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
        <input className={input} type="password" placeholder="Временный пароль от 8 знаков" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="CASHIER">Кассир — только рабочие операции</option>
          <option value="OWNER">Владелец — полный доступ</option>
        </select>
        <button disabled={busy || form.password.length < 8 || !form.username || !form.displayName} className="rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 md:col-span-2 dark:bg-white dark:text-black">{busy ? 'Создаём…' : 'Создать доступ'}</button>
      </form>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
        <h2 className="mb-3 font-semibold">Учётные записи · {staff.length}</h2>
        <ul className="space-y-2">{staff.map((user) => <StaffRow key={user.id} user={user} reload={load} />)}</ul>
        {staff.length === 0 && <p className="text-sm text-neutral-500">Именных учётных записей пока нет. Владелец ещё может входить как <code>owner</code> со старым токеном.</p>}
      </section>
    </div>
  );
}

function StaffRow({ user, reload }: { user: AdminProfile; reload: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) { setBusy(true); try { await action(); await reload(); } finally { setBusy(false); } }
  return <li className={`rounded-xl border border-black/10 p-3 dark:border-white/10 ${user.isActive === false ? 'opacity-55' : ''}`}>
    <div className="flex flex-wrap items-center gap-2"><b>{user.displayName}</b><code className="text-xs text-neutral-500">{user.username}</code><span className="rounded-lg bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{user.role === 'CASHIER' ? 'кассир' : 'владелец'}</span><span className="ml-auto text-xs text-neutral-500">{user.lastLoginAt ? `вход: ${new Date(user.lastLoginAt).toLocaleString('ru-RU')}` : 'ещё не входил'}</span></div>
    <div className="mt-3 flex flex-wrap gap-2"><input type="password" className={`${input} min-w-56 flex-1`} placeholder="Новый пароль" value={password} onChange={(e) => setPassword(e.target.value)} /><button disabled={busy || password.length < 8} onClick={() => run(() => api.patch(`/admin/staff/${user.id}/password`, { password }).then(() => setPassword('')))} className="rounded-lg border border-black/10 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/15">Сменить пароль</button><button disabled={busy} onClick={() => run(() => api.patch(`/admin/staff/${user.id}/active`, { isActive: user.isActive === false }))} className={`rounded-lg px-3 py-2 text-sm ${user.isActive === false ? 'bg-emerald-600 text-white' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{user.isActive === false ? 'Включить' : 'Отключить'}</button></div>
  </li>;
}

const input = 'rounded-xl border border-black/10 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black dark:border-white/15 dark:focus:border-white';
