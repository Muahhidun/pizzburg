import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { AvailabilityService, OrderingMode } from './availability.service';

const DURATIONS = [30, 60, 120];
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

@Injectable()
export class OrderingService {
  private readonly logger = new Logger(OrderingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly telegram: TelegramService,
  ) {}

  async current(tenantId: string, now = new Date()) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    return this.availability.getState(tenant.settings, now);
  }

  async setTemporary(
    tenantId: string,
    mode: OrderingMode,
    durationMinutes: number | undefined,
    reason: string,
    actorName: string,
    now = new Date(),
  ) {
    if (mode !== 'ALL' && !DURATIONS.includes(durationMinutes ?? 0)) {
      throw new BadRequestException('Выберите 30 минут, 1 или 2 часа');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings as Record<string, any>) ?? {};
    const oldOrdering = settings.ordering ?? {};
    const until = mode === 'ALL' ? null : new Date(now.getTime() + (durationMinutes as number) * 60_000);
    const cleanReason = reason.trim().slice(0, 200);
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...settings,
          ordering: {
            ...oldOrdering,
            mode,
            until: until?.toISOString() ?? null,
            reason: cleanReason || null,
          },
        },
      },
      select: { settings: true },
    });

    const safeActor = escapeHtml(actorName);
    const safeReason = cleanReason ? `\nПричина: ${escapeHtml(cleanReason)}` : '';
    const text = mode === 'ALL'
      ? `✅ <b>Приём заказов возобновлён</b>\nСотрудник: ${safeActor}`
      : `${mode === 'CLOSED' ? '🛑 <b>Приём заказов приостановлен</b>' : '🚗 <b>Доставка приостановлена, остался самовывоз</b>'}` +
        `\nНа ${durationMinutes} мин. Сотрудник: ${safeActor}${safeReason}`;
    await this.telegram.notify(tenantId, text);
    return this.availability.getState(updated.settings, now);
  }

  @Cron('*/1 * * * *')
  async expire(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, settings: true } });
    let cleared = 0;
    for (const tenant of tenants) {
      const settings = (tenant.settings as Record<string, any>) ?? {};
      const ordering = settings.ordering ?? {};
      if (!ordering.until || ordering.mode === 'ALL') continue;
      if (new Date(ordering.until).getTime() > now.getTime()) continue;
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { settings: { ...settings, ordering: { ...ordering, mode: 'ALL', until: null, reason: null } } },
      });
      cleared += 1;
      const text = '✅ Временное ограничение истекло — приём заказов возобновлён автоматически.';
      await Promise.all([
        this.telegram.notify(tenant.id, text),
        this.telegram.notifyCashier(tenant.id, text),
      ]);
    }
    if (cleared) this.logger.log(`Возобновлено заведений: ${cleared}`);
    return { cleared };
  }
}
