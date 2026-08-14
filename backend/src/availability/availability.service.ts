import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Единая точка ответа на вопрос «можно ли принять этот заказ сейчас».
 *
 * Здесь живут: аварийный режим приёма, расписание с профилями
 * (обычное, Рамадан, конец года), правила предзаказа и включённые
 * способы оплаты. Всё лежит в `Tenant.settings`, чтобы каждый арендатор
 * настраивал себя сам — платформа мультитенантная.
 *
 * ВАЖНО ПРО ВРЕМЯ: заведение живёт в своём часовом поясе, а сервер на
 * Railway — в UTC. Все проверки расписания считаются в поясе арендатора
 * (`settings.timezone`, по умолчанию Asia/Almaty), иначе ночные заказы
 * и время закрытия разъезжаются на пять часов.
 */

export type OrderingMode = 'ALL' | 'PICKUP_ONLY' | 'CLOSED';

/** Интервал работы в пределах одних суток: "10:00"–"22:00" */
export type HoursInterval = [string, string];

export interface ScheduleProfile {
  id: string;
  name: string;
  /** Профиль с датами перекрывает базовый на своём периоде */
  activeFrom?: string | null;
  activeTo?: string | null;
  /** mon..sun → интервалы; пустой массив = выходной */
  hours: Partial<Record<WeekdayKey, HoursInterval[]>>;
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const WEEKDAYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface PreorderSettings {
  enabled: boolean;
  /** Минимальный срок до доставки, минут */
  deliveryLeadMinutes: number;
  /** Минимальный срок до самовывоза, минут */
  pickupLeadMinutes: number;
  /** Шаг слотов, минут */
  slotStepMinutes: number;
  /** Показывать клиенту интервал «выбранное время + N минут» */
  displayPaddingMinutes: number;
  /** За сколько минут до закрытия убирать «Как можно быстрее» */
  closeAsapBeforeMinutes: number;
  /** На сколько дней вперёд можно заказать */
  maxDaysAhead: number;
}

export interface PaymentSettings {
  cash: boolean;
  cardOnDelivery: boolean;
  kaspiOnline: boolean;
  /** Спрашивать, с какой суммы готовить сдачу */
  askChangeFrom: boolean;
}

export interface CancellationSettings {
  /** Сколько минут клиент может отменить заказ сам; 0 — нельзя */
  customerWindowMinutes: number;
}

export interface AvailabilityState {
  timezone: string;
  mode: OrderingMode;
  /** Открыто ли заведение прямо сейчас по расписанию */
  isOpenNow: boolean;
  /** Можно ли оформить доставку/самовывоз с учётом режима и расписания */
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  /** Доступна ли кнопка «Как можно быстрее» (закрывается перед закрытием) */
  asapAvailable: boolean;
  /** Причина недоступности для показа клиенту */
  message: string | null;
  /** Имя активного профиля расписания — для админки */
  scheduleProfile: string | null;
  todayHours: HoursInterval[];
  preorder: PreorderSettings;
  payments: PaymentSettings;
  cancellation: CancellationSettings;
}

const DEFAULT_TIMEZONE = 'Asia/Almaty';

const DEFAULT_PREORDER: PreorderSettings = {
  enabled: true,
  deliveryLeadMinutes: 90,
  pickupLeadMinutes: 20,
  slotStepMinutes: 15,
  displayPaddingMinutes: 15,
  closeAsapBeforeMinutes: 3,
  maxDaysAhead: 7,
};

const DEFAULT_PAYMENTS: PaymentSettings = {
  cash: true,
  cardOnDelivery: true,
  kaspiOnline: false,
  askChangeFrom: true,
};

const DEFAULT_CANCELLATION: CancellationSettings = {
  customerWindowMinutes: 0,
};

@Injectable()
export class AvailabilityService {
  /** Локальные части времени арендатора без внешних зависимостей */
  private localParts(
    at: Date,
    timezone: string,
  ): { weekday: WeekdayKey; minutes: number; ymd: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(at).map((p) => [p.type, p.value]),
    ) as Record<string, string>;

    // en-CA даёт 24-часовой формат; полночь может прийти как "24"
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      parts.weekday,
    );

    return {
      weekday: WEEKDAYS[weekdayIndex < 0 ? 0 : weekdayIndex],
      minutes: hour * 60 + minute,
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
    };
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Активный профиль расписания: приоритет у профиля, чей период дат
   * покрывает сегодняшний день (Рамадан важнее обычного расписания).
   */
  private activeProfile(
    profiles: ScheduleProfile[],
    ymd: string,
  ): ScheduleProfile | null {
    const dated = profiles.filter((p) => p.activeFrom || p.activeTo);
    const match = dated.find(
      (p) =>
        (!p.activeFrom || p.activeFrom <= ymd) &&
        (!p.activeTo || ymd <= p.activeTo),
    );
    if (match) return match;
    return profiles.find((p) => !p.activeFrom && !p.activeTo) ?? profiles[0] ?? null;
  }

  private settingsOf(tenantSettings: unknown): Record<string, any> {
    return (tenantSettings as Record<string, any>) ?? {};
  }

  /** Полное состояние приёма заказов на момент `now` */
  getState(tenantSettings: unknown, now = new Date()): AvailabilityState {
    const s = this.settingsOf(tenantSettings);
    const timezone: string = s.timezone ?? DEFAULT_TIMEZONE;
    const ordering = s.ordering ?? {};
    const mode: OrderingMode = ordering.mode ?? 'ALL';

    const preorder: PreorderSettings = { ...DEFAULT_PREORDER, ...(s.preorder ?? {}) };
    const payments: PaymentSettings = { ...DEFAULT_PAYMENTS, ...(s.payments ?? {}) };
    const cancellation: CancellationSettings = {
      ...DEFAULT_CANCELLATION,
      ...(s.cancellation ?? {}),
    };

    const { weekday, minutes, ymd } = this.localParts(now, timezone);
    const profiles: ScheduleProfile[] = Array.isArray(s.schedule?.profiles)
      ? s.schedule.profiles
      : [];
    const profile = this.activeProfile(profiles, ymd);
    const todayHours: HoursInterval[] = profile?.hours?.[weekday] ?? [];

    // Нет расписания вообще — считаем, что работаем круглосуточно:
    // так новый арендатор не окажется «закрыт» из-за пустых настроек.
    const hasSchedule = profiles.length > 0;
    const openInterval = todayHours.find(
      ([from, to]) => this.toMinutes(from) <= minutes && minutes < this.toMinutes(to),
    );
    const isOpenNow = hasSchedule ? Boolean(openInterval) : true;

    // «Как можно быстрее» закрывается за N минут до конца интервала
    const asapAvailable =
      isOpenNow &&
      (!openInterval ||
        minutes < this.toMinutes(openInterval[1]) - preorder.closeAsapBeforeMinutes);

    const closed = mode === 'CLOSED';
    const pickupOnly = mode === 'PICKUP_ONLY';

    let message: string | null = null;
    if (closed) {
      message = ordering.closedMessage ?? 'Приём заказов временно приостановлен';
    } else if (!isOpenNow) {
      message = preorder.enabled
        ? 'Сейчас закрыто — можно оформить предзаказ'
        : 'Сейчас закрыто';
    } else if (pickupOnly) {
      message =
        ordering.pickupOnlyMessage ??
        'Доставка временно недоступна — можно забрать самовывозом';
    }

    // Когда закрыто, но предзаказ разрешён — приём остаётся открытым,
    // просто клиент обязан выбрать время.
    const acceptingNowOrPreorder = !closed && (isOpenNow || preorder.enabled);

    return {
      timezone,
      mode,
      isOpenNow,
      deliveryAvailable: acceptingNowOrPreorder && !pickupOnly,
      pickupAvailable: acceptingNowOrPreorder,
      asapAvailable: !closed && asapAvailable,
      message,
      scheduleProfile: profile?.name ?? null,
      todayHours,
      preorder,
      payments,
      cancellation,
    };
  }

  /**
   * Проверка заказа перед созданием. Бросает понятную клиенту ошибку.
   * Клиент тоже прячет недоступные варианты, но защищает именно сервер.
   */
  assertOrderAllowed(
    tenantSettings: unknown,
    order: {
      type: 'DELIVERY' | 'PICKUP';
      paymentMethod: 'CASH' | 'CARD_ON_DELIVERY' | 'KASPI_ONLINE';
      scheduledAt?: string | Date | null;
    },
    now = new Date(),
  ): AvailabilityState {
    const state = this.getState(tenantSettings, now);

    if (state.mode === 'CLOSED') {
      throw new BadRequestException(state.message ?? 'Приём заказов приостановлен');
    }
    if (order.type === 'DELIVERY' && !state.deliveryAvailable) {
      throw new BadRequestException(
        state.message ?? 'Доставка сейчас недоступна, доступен самовывоз',
      );
    }

    // Способ оплаты должен быть включён арендатором
    const paymentEnabled = {
      CASH: state.payments.cash,
      CARD_ON_DELIVERY: state.payments.cardOnDelivery,
      KASPI_ONLINE: state.payments.kaspiOnline,
    }[order.paymentMethod];
    if (!paymentEnabled) {
      throw new BadRequestException('Этот способ оплаты сейчас недоступен');
    }

    const scheduledAt = order.scheduledAt ? new Date(order.scheduledAt) : null;

    if (!scheduledAt) {
      // Заказ «как можно быстрее» возможен только в рабочие часы
      if (!state.isOpenNow) {
        throw new BadRequestException(
          state.preorder.enabled
            ? 'Сейчас закрыто — выберите время предзаказа'
            : 'Сейчас закрыто',
        );
      }
      if (!state.asapAvailable) {
        throw new BadRequestException(
          'Скоро закрытие — оформите заказ на конкретное время',
        );
      }
      return state;
    }

    // Дальше — проверки предзаказа
    if (!state.preorder.enabled) {
      throw new BadRequestException('Предзаказ сейчас недоступен');
    }
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Некорректное время предзаказа');
    }

    const leadMinutes =
      order.type === 'DELIVERY'
        ? state.preorder.deliveryLeadMinutes
        : state.preorder.pickupLeadMinutes;
    const minAt = new Date(now.getTime() + leadMinutes * 60_000);
    if (scheduledAt < minAt) {
      throw new BadRequestException(
        `Ближайшее время ${order.type === 'DELIVERY' ? 'доставки' : 'самовывоза'} — ` +
          `через ${leadMinutes} минут`,
      );
    }

    const maxAt = new Date(
      now.getTime() + state.preorder.maxDaysAhead * 24 * 60 * 60_000,
    );
    if (scheduledAt > maxAt) {
      throw new BadRequestException(
        `Предзаказ доступен максимум на ${state.preorder.maxDaysAhead} дней вперёд`,
      );
    }

    // Выбранное время должно попадать в рабочие часы того дня
    const target = this.getState(tenantSettings, scheduledAt);
    if (!target.isOpenNow) {
      throw new BadRequestException(
        'В выбранное время заведение закрыто — выберите другое',
      );
    }

    return state;
  }

  /**
   * Слоты предзаказа на ближайшие дни — для выбора времени в приложении.
   */
  slots(
    tenantSettings: unknown,
    type: 'DELIVERY' | 'PICKUP',
    now = new Date(),
  ): { at: string; label: string }[] {
    const state = this.getState(tenantSettings, now);
    if (!state.preorder.enabled) return [];

    const lead =
      type === 'DELIVERY'
        ? state.preorder.deliveryLeadMinutes
        : state.preorder.pickupLeadMinutes;
    const step = state.preorder.slotStepMinutes;
    const padding = state.preorder.displayPaddingMinutes;

    const result: { at: string; label: string }[] = [];
    const start = new Date(now.getTime() + lead * 60_000);
    // округляем вверх до шага слота
    start.setSeconds(0, 0);
    const startMs = Math.ceil(start.getTime() / (step * 60_000)) * step * 60_000;

    const horizonMs =
      now.getTime() + state.preorder.maxDaysAhead * 24 * 60 * 60_000;

    for (let ms = startMs; ms <= horizonMs && result.length < 96; ms += step * 60_000) {
      const at = new Date(ms);
      if (!this.getState(tenantSettings, at).isOpenNow) continue;
      const to = new Date(ms + padding * 60_000);
      const fmt = new Intl.DateTimeFormat('ru-RU', {
        timeZone: state.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      result.push({
        at: at.toISOString(),
        label: `${fmt.format(at)}–${fmt.format(to)}`,
      });
    }
    return result;
  }
}
