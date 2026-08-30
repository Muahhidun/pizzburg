'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, setToken, api, loginAdmin, AdminProfile } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api.get<AdminProfile>('/admin/auth/me')
      .then((me) => router.replace(me.role === 'CASHIER' ? '/cashier' : '/dashboard'))
      .catch(() => undefined);
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await loginAdmin(username.trim(), password);
      setToken(result.token);
      router.replace(result.user.role === 'CASHIER' ? '/cashier' : '/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-neutral-900"
      >
        <h1 className="mb-1 text-xl font-bold">PizzBurg</h1>
        <p className="mb-5 text-sm text-neutral-500">Админка доставки</p>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={50}
          placeholder="Логин"
          autoFocus
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2.5 outline-none focus:border-black dark:border-white/15 dark:focus:border-white"
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={200}
          placeholder="Пароль"
          className="mt-3 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2.5 outline-none focus:border-black dark:border-white/15 dark:focus:border-white"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          disabled={busy || !username.trim() || password.length < 8}
          className="mt-4 w-full rounded-xl bg-black py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? 'Проверяем…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
