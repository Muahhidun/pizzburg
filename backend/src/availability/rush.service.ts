import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { TelegramService } from '../telegram/telegram.service';

/** Сколько держится одна добавка, прежде чем сняться сама */
export const RUSH_HOLD_MINUTES = 60;

/** Что можно поставить кнопкой; 0 — снять добавку */
export const RUSH_STEPS = [20, 40, 60] as const;

/**
 * Режим повышенного спроса (DECISIONS §12.17).
 *
 * Заведение работает, но не успевает. Между «всё как обычно» и «приём
 * закрыт» до сих пор не было ничего, а пятничный вечер живёт именно
 * там: заказы брать надо, обещать обычный срок нельзя.
 *
 * Добавка живёт час и снимается сама. Это то же правило, что у
 * стоп-листа: включённое «плюс сорок минут» никто не снимет по своей
 * воле, потому что в разгар смены о нём просто не вспомнят, — а во
 * вторник мы будем пугать задержкой, которой нет. Через час приходит
 * напоминание, и кассир решает заново: завал ушёл или ставим ещё.
 */
@Injectable()
export class RushService {
  private readonly logger = new Logger(RushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly telegram: TelegramService,
  ) {}

  private hhmm(settings: unknown, at: Date) {
    const { timezone } = this.availability.localTime(settings, at);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  /**
   * Поставить или снять добавку.
   *
   * `extraMinutes = 0` снимает. Повторное нажатие той же кнопки — не
   * ошибка, а обычный случай: завал не кончился, час продлевается.
   */
  async set(extraMinutes: number, now = new Date(), actorName?: string) {
    if (extraMinutes !== 0 && !RUSH_STEPS.includes(extraMinutes as never)) {
      throw new BadRequestException('Допустимы только +20, +40, +60 или снятие');
    }

    const tenant = await this.prisma.tenant.findFirstOrThrow({
      where: { slug: 'pizzburg' },
      select: { id: true, settings: true },
    });
    const current = (tenant.settings as any) ?? {};
    const before = this.availability.getState(tenant.settings, now);

    const until =
      extraMinutes > 0
        ? new Date(now.getTime() + RUSH_HOLD_MINUTES * 60_000)
        : null;

    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        settings: {
          ...current,
          rush: { extraMinutes, until: until?.toISOString() ?? null },
        },
      },
      select: { settings: true },
    });

    if (extraMinutes > 0) {
      const state = this.availability.getState(updated.settings, now);
      await this.announce(
        tenant.id,
        `🔺 Высокий спрос: +${extraMinutes} мин к сроку до ${this.hhmm(
          updated.settings,
          until as Date,
        )}\nСотрудник: ${actorName ?? 'не указан'}\n\nКлиенты видят: «${state.rushNotice}»`,
      );
    } else if (before.rushExtraMinutes > 0) {
      // Молчим, если снимать было нечего: сообщение о снятии того, чего
      // не было, приучает не читать этот чат.
      await this.announce(
        tenant.id,
        '🔻 Высокий спрос снят вручную — обещаем обычный срок' +
          (actorName ? `\nСотрудник: ${actorName}` : ''),
      );
    }

    return this.availability.getState(updated.settings, now);
  }

  /**
   * Снятие по таймеру.
   *
   * Клиента задача не защищает — состояние считается на каждый запрос и
   * просроченная добавка исчезает сама. Задача нужна ради сообщения:
   * без него смена не узнает, что обещание вернулось к обычному, и
   * решение «ставить заново или нет» никто не примет.
   */
  @Cron('*/1 * * * *')
  async expire(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, settings: true },
    });

    let cleared = 0;
    for (const tenant of tenants) {
      const current = (tenant.settings as any) ?? {};
      const rush = current.rush;
      if (!rush?.extraMinutes || !rush.until) continue;
      if (new Date(rush.until).getTime() > now.getTime()) continue;

      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          settings: { ...current, rush: { extraMinutes: 0, until: null } },
        },
      });
      cleared += 1;

      await this.announce(
        tenant.id,
        `🔻 Час прошёл, добавка +${rush.extraMinutes} мин снята — ` +
          'клиентам снова обещаем обычный срок.\n\n' +
          'Если завал не ушёл, поставьте заново в админке.',
      );
    }

    if (cleared) this.logger.log(`Высокий спрос: снято добавок ${cleared}`);
    return { cleared };
  }

  /**
   * И кассе, и руководству.
   *
   * По правилу §12.11 кассе идут действия, руководству — факты. Здесь
   * это одно и то же событие с двух сторон: кассир решает, ставить ли
   * заново, а владелец видит, как часто мы не справляемся.
   */
  private async announce(tenantId: string, text: string) {
    await Promise.all([
      this.telegram.notifyCashier(tenantId, text),
      this.telegram.notify(tenantId, text),
    ]);
  }
}
