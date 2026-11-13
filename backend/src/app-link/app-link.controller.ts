import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Одна ссылка «скачать приложение» для баннера, Reels и QR на кассе.
 *
 * С iPhone сразу уводит в App Store, с Android — в Google Play: лишний
 * экран посередине теряет людей, пришедших из Instagram. На компьютере и
 * в непонятных браузерах показывает страницу с обеими кнопками.
 * `?page=1` всегда показывает страницу — чтобы её можно было проверить.
 *
 * Ссылки на сторы лежат в Tenant.settings.appLinks, как контакты
 * поддержки, — маршрут остаётся мультитенантным.
 */
@Controller('app')
export class AppLinkController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':tenantSlug')
  @Header('Cache-Control', 'no-store')
  async open(
    @Param('tenantSlug') slug: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Query('page') forcePage: string | undefined,
    @Res() res: Response,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { name: true, settings: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    const links = appLinksFrom(tenant.settings);
    if (!links.ios && !links.android) {
      throw new NotFoundException('Ссылки на приложение не настроены');
    }

    const target = forcePage ? undefined : storeFor(userAgent, links);
    if (target) return res.redirect(302, target);

    res
      .type('text/html; charset=utf-8')
      .send(renderAppLinkPage({ name: tenant.name, ...links }));
  }
}

export interface AppLinks {
  ios?: string;
  android?: string;
  /** Строка про акцию для тех, кто переходит со старого приложения */
  promo?: string;
}

export function appLinksFrom(settings: unknown): AppLinks {
  const all = (settings ?? {}) as Record<string, unknown>;
  const raw = (all.appLinks ?? {}) as Record<string, unknown>;
  const url = (v: unknown) =>
    typeof v === 'string' && /^https:\/\//.test(v.trim()) ? v.trim() : undefined;
  const text = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return { ios: url(raw.ios), android: url(raw.android), promo: text(raw.promo) };
}

/** Куда вести по User-Agent; undefined — показать страницу */
export function storeFor(userAgent: string | undefined, links: AppLinks) {
  const ua = userAgent ?? '';
  // iPadOS притворяется Mac'ом, но у Mac нет сенсорного экрана — по UA
  // их не различить, такие люди увидят страницу с двумя кнопками.
  if (/iPhone|iPad|iPod/i.test(ua)) return links.ios;
  if (/Android/i.test(ua)) return links.android;
  return undefined;
}

export function renderAppLinkPage(data: AppLinks & { name: string }) {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const button = (href: string | undefined, label: string) =>
    href ? `<a class="store" href="${esc(href)}">${label}</a>` : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Приложение ${esc(data.name)}</title>
<meta name="description" content="Скачайте новое приложение ${esc(data.name)} для iPhone и Android.">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 56px 20px 80px; max-width: 560px;
    font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #111217; background: #fff; text-align: center;
  }
  .brand { color: #6B7280; margin: 0 0 8px; }
  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 14px; }
  p { margin: 0 0 14px; }
  .promo {
    margin: 22px 0; padding: 16px 18px; border-radius: 18px;
    background: #EEF0FF; color: #1D2BB8; font-weight: 600;
  }
  .stores { display: grid; gap: 12px; margin: 28px 0 18px; }
  .store {
    display: block; padding: 16px 20px; border-radius: 999px;
    background: #2B3BEF; color: #fff; text-decoration: none; font-weight: 700;
  }
  .muted { color: #6B7280; font-size: 15px; }
  @media (prefers-color-scheme: dark) {
    body { color: #F4F5F7; background: #090A0F; }
    .brand, .muted { color: #9CA3AF; }
    .promo { background: #1C2050; color: #C9CEFF; }
  }
</style>
</head>
<body>
<p class="brand">${esc(data.name)}</p>
<h1>Новое приложение ${esc(data.name)}</h1>
<p>Заказывайте доставку и самовывоз, копите баллы и следите за заказом.</p>
${data.promo ? `<p class="promo">${esc(data.promo)}</p>` : ''}
<div class="stores">
${button(data.ios, 'Скачать в App Store')}
${button(data.android, 'Скачать в Google Play')}
</div>
<p class="muted">Откройте эту ссылку на телефоне — она сразу приведёт в нужный магазин.</p>
</body>
</html>`;
}
