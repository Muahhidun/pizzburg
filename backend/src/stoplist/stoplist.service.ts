import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { TelegramService } from '../telegram/telegram.service';
import { stopDeadline, type ScheduleLookup, type StopPreset } from './stop-deadline';

/** Что ставим на стоп: позицию витрины или целую витринную категорию */
export interface StopTarget {
  productId?: string;
  appCategoryId?: string;
}

/**
 * Свой стоп-лист со сроком (DECISIONS §12.3).
 *
 * Отдельно от стоп-листа Poster, и это пересмотренное решение: сперва
 * планировалось только зеркалить кассу. Отвергнуто по возражению
 * владельца — кассир ставит позицию на два часа и забывает вернуть, стоп
 * тянется, продавать уже можно, и это прямая потеря выручки. Срока у
 * стопа в Poster нет и добавить его туда нельзя.
 *
 * Поэтому здесь срок **обязателен**, и это главная защита: забыть
 * вернуть невозможно. Истечение работает даже без фоновой задачи —
 * меню сравнивает `stoppedUntil` с текущим временем, — а задача лишь
 * прибирает поля и закрывает запись в истории.
 */
@Injectable()
export class StopListService {
  private readonly logger = new Logger(StopListService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Время возврата словами арендатора.
   *
   * В сообщении руководству «до 2026-08-18T17:00:00.000Z» нечитаемо, а
   * человек должен понять срок с одного взгляда, не переводя часовые
   * пояса в уме.
   */
  private async localLabel(tenantId: string, at: Date) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const { timezone } = this.availability.localTime(tenant.settings, at);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  /** Расписание арендатора в виде, пригодном для расчёта срока */
  private async scheduleLookup(tenantId: string, now: Date): Promise<ScheduleLookup> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const { minutes } = this.availability.localTime(tenant.settings, now);
    return {
      nowMinutes: minutes,
      hoursOn: (daysAhead) =>
        this.availability.hoursOn(
          tenant.settings,
          new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000),
        ),
    };
  }

  /**
   * Ставит позицию или категорию на стоп до рассчитанного срока.
   *
   * `preset` обязателен: бессрочного стопа у нас нет по решению владельца.
   */
  async stop(
    tenantId: string,
    target: StopTarget,
    preset: StopPreset,
    reason = '',
    now = new Date(),
    actorName?: string,
  ) {
    const until = stopDeadline(preset, await this.scheduleLookup(tenantId, now), now);
    const note = reason.trim().slice(0, 200);

    if (target.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: target.productId, tenantId },
        select: { id: true, name: true, displayName: true },
      });
      if (!product) throw new NotFoundException('Товар не найден');

      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: product.id },
          data: { stoppedUntil: until, stoppedReason: note || null },
        }),
        // Незакрытую запись по этой же позиции закрываем: иначе повторная
        // постановка оставит в истории вечно открытый стоп и сломает отчёт
        this.prisma.stopEvent.updateMany({
          where: { productId: product.id, endedAt: null },
          data: { endedAt: now, endedBy: 'REPLACED' },
        }),
        this.prisma.stopEvent.create({
          data: { tenantId, productId: product.id, reason: note, startedAt: now, until },
        }),
      ]);
      const label = product.displayName ?? product.name;
      this.logger.log(`Стоп: «${label}» до ${until.toISOString()}${note ? ` — ${note}` : ''}`);
      // Уведомление в момент постановки, а не отчётом в конце дня:
      // злоупотребление комфортно ровно до тех пор, пока никто не смотрит
      // (DECISIONS §12.3).
      await this.telegram.notify(
        tenantId,
        `⛔️ <b>Стоп-лист</b>\n«${label}» снята с продажи до ` +
          `${await this.localLabel(tenantId, until)}` +
          (note ? `\nПричина: ${note}` : '') +
          (actorName ? `\nСотрудник: ${actorName}` : ''),
      );
      return { name: label, until };
    }

    if (target.appCategoryId) {
      const category = await this.prisma.appCategory.findFirst({
        where: { id: target.appCategoryId, tenantId },
        select: { id: true, name: true },
      });
      if (!category) throw new NotFoundException('Категория не найдена');

      await this.prisma.$transaction([
        this.prisma.appCategory.update({
          where: { id: category.id },
          data: { stoppedUntil: until, stoppedReason: note || null },
        }),
        this.prisma.stopEvent.updateMany({
          where: { appCategoryId: category.id, endedAt: null },
          data: { endedAt: now, endedBy: 'REPLACED' },
        }),
        this.prisma.stopEvent.create({
          data: { tenantId, appCategoryId: category.id, reason: note, startedAt: now, until },
        }),
      ]);
      this.logger.log(`Стоп категории «${category.name}» до ${until.toISOString()}`);
      await this.telegram.notify(
        tenantId,
        `⛔️ <b>Стоп-лист: целая категория</b>\n«${category.name}» снята с продажи до ` +
          `${await this.localLabel(tenantId, until)}` +
          (note ? `\nПричина: ${note}` : '') +
          (actorName ? `\nСотрудник: ${actorName}` : ''),
      );
      return { name: category.name, until };
    }

    throw new BadRequestException('Укажите позицию или категорию');
  }

  /** Досрочный возврат в продажу */
  async release(tenantId: string, target: StopTarget, now = new Date()) {
    if (target.productId) {
      const updated = await this.prisma.product.updateMany({
        where: { id: target.productId, tenantId },
        data: { stoppedUntil: null, stoppedReason: null },
      });
      if (updated.count === 0) throw new NotFoundException('Товар не найден');
      await this.prisma.stopEvent.updateMany({
        where: { productId: target.productId, endedAt: null },
        data: { endedAt: now, endedBy: 'MANUAL' },
      });
      return { released: true };
    }
    if (target.appCategoryId) {
      const updated = await this.prisma.appCategory.updateMany({
        where: { id: target.appCategoryId, tenantId },
        data: { stoppedUntil: null, stoppedReason: null },
      });
      if (updated.count === 0) throw new NotFoundException('Категория не найдена');
      await this.prisma.stopEvent.updateMany({
        where: { appCategoryId: target.appCategoryId, endedAt: null },
        data: { endedAt: now, endedBy: 'MANUAL' },
      });
      return { released: true };
    }
    throw new BadRequestException('Укажите позицию или категорию');
  }

  /** Что сейчас на стопе: для админки */
  async active(tenantId: string, now = new Date()) {
    const [products, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, stoppedUntil: { gt: now } },
        select: {
          id: true,
          name: true,
          displayName: true,
          stoppedUntil: true,
          stoppedReason: true,
          appCategory: { select: { name: true } },
          posterAccount: { select: { name: true } },
        },
        orderBy: { stoppedUntil: 'asc' },
      }),
      this.prisma.appCategory.findMany({
        where: { tenantId, stoppedUntil: { gt: now } },
        select: { id: true, name: true, stoppedUntil: true, stoppedReason: true },
        orderBy: { stoppedUntil: 'asc' },
      }),
    ]);

    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.displayName ?? p.name,
        category: p.appCategory?.name ?? '—',
        department: p.posterAccount.name,
        until: p.stoppedUntil,
        reason: p.stoppedReason,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        until: c.stoppedUntil,
        reason: c.stoppedReason,
      })),
    };
  }

  /**
   * Возвращает в продажу всё, у чего вышел срок.
   *
   * Меню и так не покажет стоп с истёкшим сроком — оно сравнивает дату, —
   * поэтому задача не влияет на клиента и нужна для другого: прибрать
   * поля и закрыть запись в истории, чтобы отчёт «сколько стояло» считал
   * по фактам, а не по пустым срокам.
   */
  @Cron('*/1 * * * *')
  async releaseExpired(now = new Date()) {
    const [products, categories] = await Promise.all([
      this.prisma.product.updateMany({
        where: { stoppedUntil: { lte: now } },
        data: { stoppedUntil: null, stoppedReason: null },
      }),
      this.prisma.appCategory.updateMany({
        where: { stoppedUntil: { lte: now } },
        data: { stoppedUntil: null, stoppedReason: null },
      }),
    ]);
    const closed = await this.prisma.stopEvent.updateMany({
      where: { endedAt: null, until: { lte: now } },
      data: { endedAt: now, endedBy: 'EXPIRED' },
    });
    if (products.count + categories.count > 0) {
      this.logger.log(
        `Стоп-лист: вернулось в продажу позиций ${products.count}, категорий ${categories.count}`,
      );
    }
    return { products: products.count, categories: categories.count, closed: closed.count };
  }
}
