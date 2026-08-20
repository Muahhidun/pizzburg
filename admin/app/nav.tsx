'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearToken } from '@/lib/api';

/**
 * Боковая навигация админки.
 *
 * Была строкой поверху и переросла её: четырнадцать вкладок не помещались,
 * последние уезжали за край и находились только горизонтальной прокруткой —
 * то есть «Документы» и «Настройки» фактически исчезли. По вертикали места
 * достаточно, и разделы можно ещё и сгруппировать.
 *
 * На узком экране колонка сворачивается, но «Касса» остаётся снаружи
 * отдельной кнопкой: её открывают с телефона и в спешке, когда чего-то нет,
 * и прятать её под бургер значит добавить тап ровно там, где он дороже
 * всего.
 */
const groups: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Работа',
    links: [
      { href: '/dashboard', label: 'Сводка' },
      { href: '/cashier', label: 'Касса' },
      { href: '/orders', label: 'Заказы' },
    ],
  },
  {
    title: 'Меню',
    links: [
      { href: '/storefront', label: 'Витрина' },
      { href: '/stoplist', label: 'Стоп-листы' },
    ],
  },
  {
    title: 'Маркетинг',
    links: [
      { href: '/promotions', label: 'Акции' },
      { href: '/loyalty', label: 'Кэшбэк' },
      { href: '/messages', label: 'Сообщения' },
    ],
  },
  {
    title: 'Клиенты',
    links: [
      { href: '/customers', label: 'Клиенты' },
      { href: '/addresses', label: 'Адреса' },
    ],
  },
  {
    title: 'Отчёты',
    links: [{ href: '/cancellations', label: 'Отмены' }],
  },
  {
    title: 'Настройки',
    links: [
      { href: '/operations', label: 'Режим работы' },
      { href: '/legal', label: 'Документы' },
      { href: '/settings', label: 'Настройки' },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Переход по ссылке закрывает меню на телефоне: иначе оно остаётся
  // поверх страницы, ради которой его и открывали.
  useEffect(() => setOpen(false), [pathname]);

  if (pathname === '/') return null;

  return (
    <>
      {/* Узкий экран: бургер и «Касса» рядом с ним */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-white/10 dark:bg-neutral-900/90">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Меню"
          className="rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
        >
          {open ? '✕' : '☰'}
        </button>
        <Link
          href="/cashier"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            pathname.startsWith('/cashier')
              ? 'bg-black text-white dark:bg-white dark:text-black'
              : 'border border-black/10 dark:border-white/15'
          }`}
        >
          Касса
        </Link>
        <span className="ml-auto rounded-lg bg-black px-2.5 py-1 text-sm font-bold text-white dark:bg-white dark:text-black">
          PizzBurg
        </span>
      </header>

      <nav
        className={`fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto border-r border-black/10 bg-white px-3 py-4 dark:border-white/10 dark:bg-neutral-900 ${
          open ? 'block' : 'hidden'
        } lg:block`}
      >
        <div className="mb-4 flex items-center justify-between px-2">
          <span className="rounded-lg bg-black px-2.5 py-1 text-sm font-bold text-white dark:bg-white dark:text-black">
            PizzBurg
          </span>
          <button
            onClick={() => setOpen(false)}
            className="text-sm text-neutral-400 lg:hidden"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {group.title}
            </div>
            {group.links.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`block rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        ))}

        <button
          onClick={() => {
            clearToken();
            window.location.href = '/';
          }}
          className="mt-2 w-full rounded-lg px-2.5 py-2 text-left text-sm text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          Выйти
        </button>
      </nav>

      {/* Затемнение под открытым меню — только на телефоне */}
      {open && (
        <button
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}
    </>
  );
}
