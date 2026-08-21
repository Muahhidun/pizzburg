'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearToken } from '@/lib/api';
import { ThemePicker } from './theme';

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
/**
 * Цвет у заголовка группы, а не у ссылок.
 *
 * Одним серым по серому заголовок читался как ещё одна вкладка, только
 * бледнее, и колонка превращалась в четырнадцать одинаковых строк. Цвет
 * плюс засечка слева сразу говорят: это подпись раздела, а не то, куда
 * можно нажать. Ссылки остаются нейтральными — цветное здесь только то,
 * что не кликается, и спутать их уже нельзя.
 */
const groups: {
  title: string;
  tint: string;
  links: { href: string; label: string }[];
}[] = [
  {
    title: 'Работа',
    tint: 'text-emerald-600 dark:text-emerald-400',
    links: [
      { href: '/dashboard', label: 'Сводка' },
      { href: '/cashier', label: 'Касса' },
      { href: '/orders', label: 'Заказы' },
    ],
  },
  {
    title: 'Меню',
    tint: 'text-amber-600 dark:text-amber-400',
    links: [
      { href: '/storefront', label: 'Витрина' },
      { href: '/stoplist', label: 'Стоп-листы' },
      { href: '/upsell', label: 'Допродажи' },
    ],
  },
  {
    title: 'Маркетинг',
    tint: 'text-violet-600 dark:text-violet-400',
    links: [
      { href: '/promotions', label: 'Акции' },
      { href: '/loyalty', label: 'Кэшбэк' },
      { href: '/messages', label: 'Сообщения' },
    ],
  },
  {
    title: 'Клиенты',
    tint: 'text-sky-600 dark:text-sky-400',
    links: [
      { href: '/customers', label: 'Клиенты' },
      { href: '/addresses', label: 'Адреса' },
    ],
  },
  {
    title: 'Отчёты',
    tint: 'text-rose-600 dark:text-rose-400',
    links: [{ href: '/cancellations', label: 'Отмены' }],
  },
  {
    title: 'Настройки',
    tint: 'text-teal-600 dark:text-teal-400',
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

        {groups.map((group, i) => (
          <div
            key={group.title}
            className={`mb-4 ${
              i > 0
                ? 'mt-4 border-t border-black/5 pt-4 dark:border-white/10'
                : ''
            }`}
          >
            <div className="flex items-center gap-2 px-2 pb-1.5">
              <span
                className={`h-3.5 w-[3px] rounded-full bg-current ${group.tint}`}
              />
              <span
                className={`text-[11px] font-bold uppercase tracking-widest ${group.tint}`}
              >
                {group.title}
              </span>
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

        <div className="mt-6 border-t border-black/5 pt-4 dark:border-white/10">
          <ThemePicker />
        </div>

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
