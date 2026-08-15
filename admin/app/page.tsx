'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, setToken, api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/dashboard');
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const token = value.trim();
    // Проверяем токен до записи в localStorage: иначе неверный оседает в
    // хранилище, а редирект внутри api.request перезагружает эту же страницу
    // и стирает сообщение об ошибке.
    try {
      const res = await fetch(`${api.raw}/admin/settings`, {
        headers: { 'X-Admin-Token': token },
      });
      if (res.status === 401) {
        setError('Неверный токен');
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(`Сервер ответил ошибкой ${res.status}`);
        setBusy(false);
        return;
      }
      setToken(token);
      router.replace('/dashboard');
    } catch {
      setError('Сервер недоступен');
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
        {/*
          Менеджеру паролей нужна пара «логин + пароль»: по одному полю
          Keychain и Chrome сохраняют запись через раз и потом не подставляют
          её обратно. Логин у нас общий, поэтому поле скрыто и readOnly —
          оно существует только как якорь для автозаполнения. Прятать его
          через display:none нельзя, такие поля менеджеры игнорируют.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="PizzBurg админка"
          readOnly
          tabIndex={-1}
          className="sr-only"
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={500}
          placeholder="Токен доступа"
          autoFocus
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2.5 outline-none focus:border-black dark:border-white/15 dark:focus:border-white"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          disabled={busy || !value.trim()}
          className="mt-4 w-full rounded-xl bg-black py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? 'Проверяем…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
