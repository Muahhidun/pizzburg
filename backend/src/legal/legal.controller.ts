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
