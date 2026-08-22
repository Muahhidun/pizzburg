import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Белый список типов (DECISIONS §12.24).
 *
 * Свободные строки превращают таблицу в свалку, по которой нельзя
 * построить ни одного отчёта: сегодня приложение пишет `search`, завтра
 * `menu_search`, и половина данных теряется на опечатке.
 */
export const EVENT_TYPES = {
  /// Открыли приложение — знаменатель для всех воронок
  app_open: 'app_open',
  /// { query, results } — «искал и не нашёл» видно только отсюда
  search: 'search',
  /// { productId } — смотрел карточку
  product_view: 'product_view',
  /// { productIds } — какие допродажи показали
  upsell_shown: 'upsell_shown',
  /// { productId } — какую взяли
  upsell_added: 'upsell_added',
  /// Дошёл до оформления. Заказ следом или нет — видно по заказам
  checkout_open: 'checkout_open',
} as const;

export type EventType = keyof typeof EVENT_TYPES;

/** Больше за раз приложению незачем, а нам — тем более */
export const MAX_EVENTS_PER_BATCH = 50;

/**
 * Сколько храним.
 *
 * Полгода: сезонность видна, а таблица не растёт бесконечно. Отчёты
 * строятся по агрегатам, и сырое событие годичной давности не нужно
 * никому.
 */
export const EVENT_RETENTION_DAYS = 180;

export interface IncomingEvent {
  type: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Записать пачку.
   *
   * Неизвестные типы молча отбрасываем, а не роняем весь запрос: старая
   * сборка приложения не должна получать ошибку из-за события, которое
   * мы переименовали. Аналитика — побочный канал, ломать из-за неё
   * работу приложения нельзя.
   */
  async record(
    tenantId: string,
    events: IncomingEvent[],
    context: { customerId?: string | null; deviceId?: string | null },
  ) {
    const rows = events
      .slice(0, MAX_EVENTS_PER_BATCH)
      .filter((e) => e.type in EVENT_TYPES)
      .map((e) => ({
        tenantId,
        type: e.type,
        customerId: context.customerId ?? null,
        deviceId: context.deviceId?.slice(0, 64) ?? null,
        payload: this.clean(e.payload),
      }));

    if (rows.length === 0) return { recorded: 0 };
    await this.prisma.appEvent.createMany({ data: rows });
    return { recorded: rows.length };
  }

  /**
   * Обрезаем нагрузку.
   *
   * Поле открыто наружу, и без предела туда можно залить что угодно.
   * Строки режем, вложенность выбрасываем: в отчётах нужны короткие
   * значения, а не произвольные деревья.
   */
  private clean(
    payload: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, value] of Object.entries(payload ?? {}).slice(0, 10)) {
      if (typeof value === 'string') out[key] = value.slice(0, 200);
      else if (typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
      } else if (Array.isArray(value)) {
        out[key] = value
          .slice(0, 20)
          .filter((v) => typeof v === 'string')
          .map((v) => (v as string).slice(0, 64));
      }
    }
    return out;
  }

  /** Раз в сутки убираем старое: таблица растёт быстрее всех остальных */
  @Cron('17 4 * * *')
  async prune(now = new Date()) {
    const before = new Date(
      now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000,
    );
    const { count } = await this.prisma.appEvent.deleteMany({
      where: { at: { lt: before } },
    });
    if (count) this.logger.log(`События: удалено старых ${count}`);
    return { deleted: count };
  }
}
