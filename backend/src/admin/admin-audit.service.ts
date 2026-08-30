import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActorValue } from './admin-actor';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async record(
    actor: AdminActorValue,
    entry: {
      action: string;
      summary: string;
      entityType?: string;
      entityId?: string;
      metadata?: Prisma.InputJsonValue;
      notifyOwner?: boolean;
    },
  ) {
    const saved = await this.prisma.adminAuditLog.create({
      data: {
        tenantId: actor.tenantId,
        staffUserId: actor.id,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: entry.action,
        summary: entry.summary,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
      },
    });
    if (entry.notifyOwner && actor.role === 'CASHIER') {
      const safe = (value: string) =>
        value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await this.telegram.notify(
        actor.tenantId,
        `👤 <b>Действие кассира</b>\n` +
          `${safe(actor.displayName)}: ${safe(entry.summary)}`,
      );
    }
    return saved;
  }

  list(tenantId: string, take = 200) {
    return this.prisma.adminAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 500),
    });
  }
}
