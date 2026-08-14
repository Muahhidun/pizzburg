import {
  Controller,
  Get,
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

  /** Клиент подтверждает согласие с действующими редакциями */
  @Post(':tenantSlug/accept')
  @UseGuards(CustomerAuthGuard)
  async accept(@Param('tenantSlug') slug: string, @Req() req: any) {
    return this.legal.accept(req.customer.sub, await this.tenantId(slug));
  }
}
