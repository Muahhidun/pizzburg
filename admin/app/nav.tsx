'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clearToken } from '@/lib/api';

const links = [
  { href: '/dashboard', label: 'Сводка' },
  { href: '/orders', label: 'Заказы' },
  { href: '/storefront', label: 'Витрина' },
  { href: '/stoplist', label: 'Стоп-листы' },
  { href: '/customers', label: 'Клиенты' },
  { href: '/promotions', label: 'Акции' },
  { href: '/settings', label: 'Настройки' },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <header className="sticky top-0 z-20 border-b border-black/10 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-3">
        <span className="mr-3 shrink-0 rounded-lg bg-black px-2.5 py-1 text-sm font-bold text-white dark:bg-white dark:text-black">
          PizzBurg
        </span>
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <button
          onClick={() => {
            clearToken();
            window.location.href = '/';
          }}
          className="ml-auto shrink-0 rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          Выйти
        </button>
      </div>
    </header>
  );
}
