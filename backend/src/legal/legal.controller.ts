import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { LegalService } from './legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';

/**
 * Публичные документы. Ссылки на них нужны и в приложении, и в сторах —
 * Apple с Google требуют работающий URL политики конфиденциальности.
 */
@Controller('legal')
export class LegalController {
  constructor(
    private readonly legal: LegalService,
    private readonly prisma: PrismaService,
  ) {}

  private async tenantId(slug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    return tenant.id;
  }

  @Get(':tenantSlug')
  async all(@Param('tenantSlug') slug: string) {
    return { documents: await this.legal.current(await this.tenantId(slug)) };
  }

  @Get(':tenantSlug/:type')
  async one(@Param('tenantSlug') slug: string, @Param('type') type: string) {
    const upper = type.toUpperCase();
    if (!['OFFER', 'PRIVACY', 'REQUISITES'].includes(upper)) {
      throw new NotFoundException('Неизвестный тип документа');
    }
    const doc = await this.legal.currentOne(
      await this.tenantId(slug),
      upper as LegalDocumentType,
    );
    return {
      type: doc.type,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      publishedAt: doc.publishedAt,
    };
  }

  /**
   * Публичная страница поддержки для App Store и Google Play.
   *
   * Контакты лежат в Tenant.settings.support, чтобы маршрут
   * оставался мультитенантным. Адрес берём из активной точки.
   */
  @Get(':tenantSlug/support/page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async supportPage(@Param('tenantSlug') slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        name: true,
        settings: true,
        venues: {
          where: { isActive: true },
          orderBy: { id: 'asc' },
          take: 1,
          select: { address: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const support = (settings.support ?? {}) as Record<string, unknown>;
    return renderSupportPage({
      name: tenant.name,
      phone: stringSetting(support.phone),
      email: stringSetting(support.email),
      hours: stringSetting(support.hours),
      address: tenant.venues[0]?.address,
    });
  }

  /**
   * Та же страница, но HTML — для App Store и Google Play.
   *
   * Магазины требуют работающую публичную ссылку на политику
   * конфиденциальности, и открывает её робот, а не приложение. JSON он
   * не поймёт, а своего сайта у нас пока нет, поэтому отдаём страницу
   * прямо отсюда: `/legal/pizzburg/privacy/page`.
   */
  @Get(':tenantSlug/:type/page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async page(@Param('tenantSlug') slug: string, @Param('type') type: string) {
    const upper = type.toUpperCase();
    if (!['OFFER', 'PRIVACY', 'REQUISITES'].includes(upper)) {
      throw new NotFoundException('Неизвестный тип документа');
    }
    const doc = await this.legal.currentOne(
      await this.tenantId(slug),
      upper as LegalDocumentType,
    );
    return renderLegalPage(doc.title, doc.content, doc.version);
  }

  /** Клиент подтверждает согласие с действующими редакциями */
  @Post(':tenantSlug/accept')
  @UseGuards(CustomerAuthGuard)
  async accept(@Param('tenantSlug') slug: string, @Req() req: any) {
    return this.legal.accept(req.customer.sub, await this.tenantId(slug));
  }
}

/// Документ хранится обычным текстом, поэтому и страница простая:
/// экранируем, сохраняем переводы строк, задаём читаемую ширину.
/// Ничего внешнего не подключаем — страницу открывают роботы магазинов,
/// и она должна открываться всегда и быстро.
function renderLegalPage(title: string, content: string, version: number) {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — PizzBurg</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 40px 20px 80px; max-width: 720px;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #16191A; background: #fff;
  }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; }
  .meta { color: #6B7280; font-size: 14px; margin: 0 0 28px; }
  pre {
    white-space: pre-wrap; word-wrap: break-word; font: inherit; margin: 0;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #E7EBEB; background: #16191A; }
    .meta { color: #9AA5A6; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="meta">PizzBurg · редакция ${version}</p>
<pre>${esc(content)}</pre>
</body>
</html>`;
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface SupportPageData {
  name: string;
  phone?: string;
  email?: string;
  hours?: string;
  address?: string;
}

export function renderSupportPage(data: SupportPageData) {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const phoneHref = data.phone?.replace(/[^+\d]/g, '');
  const contactRows = [
    data.phone && phoneHref
      ? `<a class="contact" href="tel:${esc(phoneHref)}"><span>Телефон</span><strong>${esc(data.phone)}</strong></a>`
      : '',
    data.email
      ? `<a class="contact" href="mailto:${esc(data.email)}"><span>Почта</span><strong>${esc(data.email)}</strong></a>`
      : '',
  ].join('');
  const deletionRequest = data.email
    ? `<p>Если приложение недоступно, отправьте запрос с номера или почты, связанных с аккаунтом:</p>
<a class="contact" href="mailto:${esc(data.email)}?subject=${encodeURIComponent(`Удаление аккаунта ${data.name}`)}"><span>Запросить удаление</span><strong>${esc(data.email)}</strong></a>`
    : '<p>Если приложение недоступно, свяжитесь с поддержкой по контактам выше.</p>';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Поддержка — ${esc(data.name)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 40px 20px 80px; max-width: 720px;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #111217; background: #fff;
  }
  h1 { font-size: 30px; line-height: 1.15; margin: 0 0 12px; }
  h2 { font-size: 19px; margin: 32px 0 10px; }
  p { margin: 0 0 12px; }
  .muted { color: #6B7280; }
  .contact {
    display: flex; justify-content: space-between; gap: 20px; margin: 10px 0;
    padding: 16px 18px; border: 1px solid #E5E7EB; border-radius: 16px;
    color: inherit; text-decoration: none;
  }
  .contact span { color: #6B7280; }
  .contact strong { text-align: right; overflow-wrap: anywhere; }
  .card { padding: 18px; border-radius: 18px; background: #F3F4F6; }
  a { color: #3047F4; }
  @media (prefers-color-scheme: dark) {
    body { color: #F4F5F7; background: #090A0F; }
    .muted, .contact span { color: #9CA3AF; }
    .contact { border-color: #30323A; }
    .card { background: #202129; }
    a { color: #91A0FF; }
  }
</style>
</head>
<body>
<p class="muted">${esc(data.name)}</p>
<h1>Поддержка</h1>
<p>Поможем с заказом, оплатой, баллами и работой приложения.</p>
${contactRows || '<p class="card">Контакты поддержки временно недоступны.</p>'}
${data.hours ? `<p class="muted">Режим работы: ${esc(data.hours)}</p>` : ''}
${data.address ? `<h2>Адрес</h2><p>${esc(data.address)}</p>` : ''}
<h2>Прямо в приложении</h2>
<p>Откройте нужный заказ и нажмите «Написать нам» — мы сразу увидим номер заказа.</p>
<h2>Удаление аккаунта</h2>
<p>Профиль → Настройки приложения → Удалить аккаунт.</p>
${deletionRequest}
<p class="muted">Будут удалены баллы, адреса, избранное и вход по номеру. Заказы сохраняются у заведения без адреса и комментария — они нужны для отчётности.</p>
</body>
</html>`;
}
