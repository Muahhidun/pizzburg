import type { Metadata } from 'next';
import './globals.css';
import { Nav } from './nav';
import { themeBootScript } from './theme';

export const metadata: Metadata = {
  title: 'PizzBurg — админка',
  description: 'Управление меню, заказами и акциями',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Тема ставится до первой отрисовки — иначе страница моргает
            светлым на тёмной теме. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <Nav />
        {/* Отступ слева только на широком экране: на телефоне колонка
            выезжает поверх, а не раздвигает содержимое. */}
        <main className="px-4 py-6 lg:pl-60">
          <div className="mx-auto max-w-6xl lg:px-4">{children}</div>
        </main>
      </body>
    </html>
  );
}
