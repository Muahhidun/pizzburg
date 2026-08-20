'use client';

import { useEffect, useState } from 'react';

export const THEME_KEY = 'pizzburg-theme';

export type ThemeName = 'light' | 'dark' | 'papyrus' | 'dusk';

/**
 * Порядок как у выключателя света: от самой светлой к самой тёмной.
 * Кружок показывает лист и чернила темы, а не абстрактный цвет — по нему
 * видно, что получится, до нажатия.
 */
export const THEMES: {
  id: ThemeName;
  label: string;
  paper: string;
  ink: string;
}[] = [
  { id: 'light', label: 'Светлая', paper: '#ffffff', ink: '#111111' },
  { id: 'papyrus', label: 'Папирус', paper: '#f3e9d6', ink: '#2f2820' },
  { id: 'dusk', label: 'Сумерки', paper: '#1a212b', ink: '#dbe2ec' },
  { id: 'dark', label: 'Тёмная', paper: '#0d0d0d', ink: '#f2f2f2' },
];

/**
 * Ставит тему до первой отрисовки.
 *
 * Скрипт синхронный и стоит в разметке: если решать тему после загрузки
 * React, страница успевает моргнуть светлым на тёмной теме — на кассе
 * ночью это неприятно вдвойне.
 *
 * Пока человек не выбрал тему сам, ничего не запоминаем и идём за
 * системой: тот, кто выключателем не пользуется, не должен заметить, что
 * он появился.
 */
export const themeBootScript = `(function(){try{
var t=localStorage.getItem('${THEME_KEY}');
if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.dataset.theme=t;
}catch(e){document.documentElement.dataset.theme='light';}})();`;

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeName | null;
    const system = matchMedia('(prefers-color-scheme: dark)');
    setTheme(stored ?? (system.matches ? 'dark' : 'light'));

    // Выбора нет — продолжаем следовать за системой и после загрузки
    if (stored) return;
    const follow = (e: MediaQueryListEvent) => {
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    system.addEventListener('change', follow);
    return () => system.removeEventListener('change', follow);
  }, []);

  const pick = (id: ThemeName) => {
    document.documentElement.dataset.theme = id;
    localStorage.setItem(THEME_KEY, id);
    setTheme(id);
  };

  return (
    <div className="px-2">
      <div className="pb-1.5 text-[11px] font-bold tracking-widest text-neutral-400 uppercase">
        Тема
      </div>
      <div className="flex gap-1.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            title={t.label}
            aria-label={`Тема «${t.label}»`}
            aria-pressed={theme === t.id}
            className={`h-7 w-7 rounded-full border transition ${
              theme === t.id
                ? 'border-black ring-2 ring-black/20 dark:border-white dark:ring-white/30'
                : 'border-black/15 hover:border-black/40 dark:border-white/20 dark:hover:border-white/50'
            }`}
            style={{ background: t.paper }}
          >
            {/* Чернила темы — чтобы кружок не был просто светлым пятном */}
            <span
              className="mx-auto block h-2.5 w-2.5 rounded-full"
              style={{ background: t.ink }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
