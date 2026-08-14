import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LegalDocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Юридические документы: оферта, политика конфиденциальности, реквизиты.
 *
 * Зачем версии, а не одно поле с текстом: Apple и Google требуют
 * доступную политику конфиденциальности, а при споре нужно доказать,
 * с какой именно редакцией согласился клиент. Поэтому старые версии
 * не перезаписываются, а согласие хранится номером версии.
 */
@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Действующие редакции всех документов арендатора */
  async current(tenantId: string) {
    const docs = await this.prisma.legalDocument.findMany({
      where: { tenantId, isCurrent: true },
      orderBy: { type: 'asc' },
    });
    return docs.map((d) => ({
      type: d.type,
      version: d.version,
      title: d.title,
      content: d.content,
      publishedAt: d.publishedAt,
    }));
  }

  async currentOne(tenantId: string, type: LegalDocumentType) {
    const doc = await this.prisma.legalDocument.findFirst({
      where: { tenantId, type, isCurrent: true },
    });
    if (!doc) throw new NotFoundException('Документ ещё не опубликован');
    return doc;
  }

  /** Карта «тип → действующая версия» для проверки согласия */
  async currentVersions(tenantId: string): Promise<Record<string, number>> {
    const docs = await this.prisma.legalDocument.findMany({
      where: { tenantId, isCurrent: true },
      select: { type: true, version: true },
    });
    return Object.fromEntries(docs.map((d) => [d.type, d.version]));
  }

  /**
   * Каких обязательных документов клиент ещё не принял.
   * Реквизиты — справочные, согласия не требуют.
   */
  async pendingConsent(
    tenantId: string,
    accepted: unknown,
  ): Promise<{ type: string; version: number }[]> {
    const required: LegalDocumentType[] = ['OFFER', 'PRIVACY'];
    const current = await this.currentVersions(tenantId);
    const has = (accepted ?? {}) as Record<string, number>;
    return required
      .filter((type) => current[type] != null && has[type] !== current[type])
      .map((type) => ({ type, version: current[type] }));
  }

  /**
   * Публикация новой редакции. Номер версии считаем сами, чтобы две
   * правки подряд не затёрли друг друга.
   */
  async publish(
    tenantId: string,
    type: LegalDocumentType,
    title: string,
    content: string,
  ) {
    if (!content.trim()) {
      throw new BadRequestException('Текст документа не может быть пустым');
    }
    const last = await this.prisma.legalDocument.aggregate({
      where: { tenantId, type },
      _max: { version: true },
    });
    const version = (last._max.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      await tx.legalDocument.updateMany({
        where: { tenantId, type, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.legalDocument.create({
        data: { tenantId, type, version, title, content, isCurrent: true },
      });
    });
  }

  /** История редакций — для админки */
  async history(tenantId: string, type: LegalDocumentType) {
    return this.prisma.legalDocument.findMany({
      where: { tenantId, type },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        title: true,
        isCurrent: true,
        publishedAt: true,
      },
    });
  }

  /** Клиент принял действующие редакции */
  async accept(customerId: string, tenantId: string) {
    const versions = await this.currentVersions(tenantId);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { legalVersions: versions, legalAcceptedAt: new Date() },
      select: { legalVersions: true, legalAcceptedAt: true },
    });
  }
}
