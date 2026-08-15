import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Лента сообщений заведения: акции, новости, объявления.
 *
 * Пуш живёт секунды, сообщение остаётся: клиент возвращается к условиям
 * акции в приложении, а не ищет их в шторке уведомлений. Поэтому рассылка
 * всегда привязана к сообщению ленты, отдельного «просто пуша» нет — не
 * должно существовать обещаний, на которые потом нельзя сослаться.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async tenant(slug = 'pizzburg') {
    const t = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!t) throw new NotFoundException('Unknown tenant');
    return t;
  }

  /** Публичная лента — свежие сверху; гости тоже видят */
  async feed(tenantSlug = 'pizzburg') {
    const tenant = await this.tenant(tenantSlug);
    return this.prisma.message.findMany({
      where: { tenantId: tenant.id, isPublished: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        imageUrl: true,
        createdAt: true,
      },
    });
  }

  // ─── Админка ─────────────────────────────────────────────────

  async list() {
    const tenant = await this.tenant();
    return this.prisma.message.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(input: {
    title: string;
    body: string;
    imageUrl?: string | null;
    sendPush?: boolean;
  }) {
    const tenant = await this.tenant();
    const message = await this.prisma.message.create({
      data: {
        tenantId: tenant.id,
        title: input.title.trim(),
        body: input.body.trim(),
        imageUrl: input.imageUrl?.trim() || null,
      },
    });

    // Пуш уходит ПОСЛЕ записи в ленту: клиент, открывший уведомление,
    // должен найти сообщение, а не пустоту
    let push: { sent: number; configured: boolean } | null = null;
    if (input.sendPush) {
      push = await this.notifications.broadcast(
        message.id,
        message.title,
        message.body,
      );
      if (push.configured) {
        await this.prisma.message.update({
          where: { id: message.id },
          data: { pushSentAt: new Date() },
        });
      }
    }
    return { message, push };
  }

  /** Снятие с публикации — сообщение остаётся в базе как история */
  async setPublished(id: string, isPublished: boolean) {
    return this.prisma.message.update({
      where: { id },
      data: { isPublished },
    });
  }
}
