import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Справочник причин отмены.
 *
 * Свободный текст кассира невозможно сгруппировать в отчёт, поэтому
 * отмена всегда привязывается к позиции справочника, а комментарий
 * остаётся дополнением. У PizzBurg частые отмены по отделу Sunday —
 * без этого отчёта непонятно, что именно чинить.
 */
@Injectable()
export class CancelReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Стартовый набор — создаётся при первом обращении, чтобы список не был пуст.
   *
   * Два списка в одном справочнике, и делит их `availableToCustomer`.
   *
   * Кассир отменяет заказ в любой момент его жизни, поэтому её причины
   * описывают кухню и доставку. Клиент отменяет только внутри окна
   * бесплатной отмены — то есть в первую минуту, когда заведение о заказе
   * ещё не знает. «Долгое ожидание» там физически невозможно, а «клиент
   * передумал» он читает про себя в третьем лице.
   *
   * Клиентские причины намеренно разнесены, а не свёрнуты в «передумал»:
   * пять из шести — это не каприз, а наш экран, на котором человек
   * ошибся, и по каждой видно, что чинить.
   */
  private readonly defaults = [
    { label: 'Нет позиции в наличии', availableToCustomer: false },
    { label: 'Клиент передумал', availableToCustomer: false },
    { label: 'Клиент ошибся в заказе', availableToCustomer: false },
    { label: 'Долгое ожидание', availableToCustomer: false },
    { label: 'Клиент не отвечает', availableToCustomer: false },
    { label: 'Нет курьеров', availableToCustomer: false },
    { label: 'Адрес вне зоны доставки', availableToCustomer: false },
    { label: 'Дубль заказа', availableToCustomer: false },
    { label: 'Технический сбой', availableToCustomer: false },

    // Казахский только у клиентских: кассирские причины читает кассир,
    // и они живут в админке на одном языке.
    {
      label: 'Не тот адрес',
      labelKk: 'Мекенжай дұрыс емес',
      availableToCustomer: true,
    },
    {
      label: 'Перепутал доставку и самовывоз',
      labelKk: 'Жеткізу мен өзі алып кетуді шатастырдым',
      availableToCustomer: true,
    },
    {
      label: 'Не тот способ оплаты',
      labelKk: 'Төлем тәсілі дұрыс емес',
      availableToCustomer: true,
    },
    {
      label: 'Не то время',
      labelKk: 'Уақыты дұрыс емес',
      availableToCustomer: true,
    },
    {
      label: 'Забыл добавить блюдо',
      labelKk: 'Тағам қосуды ұмытып кетіппін',
      availableToCustomer: true,
    },
    {
      label: 'Просто передумал',
      labelKk: 'Жай ғана ойымды өзгерттім',
      availableToCustomer: true,
    },
  ];

  async list(tenantId: string, onlyForCustomer = false) {
    let reasons = await this.prisma.cancelReason.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (reasons.length === 0) {
      await this.prisma.cancelReason.createMany({
        data: this.defaults.map((r, i) => ({ ...r, tenantId, sortOrder: i + 1 })),
        skipDuplicates: true,
      });
      reasons = await this.prisma.cancelReason.findMany({
        where: { tenantId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return onlyForCustomer
      ? reasons.filter((r) => r.availableToCustomer)
      : reasons;
  }

  /** Название причины, под которой закрывается отказ из-за нехватки позиции */
  static readonly shortageLabel = 'Нет позиции в наличии';

  /**
   * Причина для отмены по нехватке позиции (DECISIONS §12.9).
   *
   * Клиент отказывается от заказа не «потому что передумал», а потому что
   * у нас чего-то нет, — и в отчёте это должно лежать в той же строке, что
   * и отмены кассира по той же причине. Если владелец удалил или выключил
   * стандартную причину, возвращаем null: отменить заказ всё равно нужно,
   * просто без разбивки.
   */
  async shortageReasonId(tenantId: string): Promise<string | null> {
    const reasons = await this.list(tenantId);
    return (
      reasons.find((r) => r.label === CancelReasonsService.shortageLabel)?.id ??
      null
    );
  }

  /** Все причины, включая выключенные — для админки */
  async listAll(tenantId: string) {
    await this.list(tenantId); // гарантируем стартовый набор
    return this.prisma.cancelReason.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(
    tenantId: string,
    data: { label: string; availableToCustomer?: boolean },
  ) {
    const last = await this.prisma.cancelReason.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    });
    return this.prisma.cancelReason.create({
      data: {
        tenantId,
        label: data.label.trim(),
        availableToCustomer: data.availableToCustomer ?? false,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
  }

  async update(
    id: string,
    data: {
      label?: string;
      labelKk?: string | null;
      isActive?: boolean;
      availableToCustomer?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.prisma.cancelReason.update({
      where: { id },
      data: {
        ...data,
        labelKk: data.labelKk === '' ? null : data.labelKk?.trim(),
      },
    });
  }

  /** Проверяет, что причина принадлежит арендатору и доступна вызывающему */
  async resolve(
    tenantId: string,
    reasonId: string,
    forCustomer: boolean,
  ): Promise<string> {
    const reason = await this.prisma.cancelReason.findFirst({
      where: { id: reasonId, tenantId, isActive: true },
    });
    if (!reason) throw new BadRequestException('Неизвестная причина отмены');
    if (forCustomer && !reason.availableToCustomer) {
      throw new BadRequestException('Эта причина недоступна клиенту');
    }
    return reason.label;
  }

  /** Отчёт по отменам за период: сколько и на какую сумму */
  async report(tenantId: string, from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status: 'CANCELLED',
        cancelledAt: { gte: from, lt: to },
      },
      select: {
        total: true,
        cancelledBy: true,
        cancelReason: true,
        cancelReasonRef: { select: { id: true, label: true } },
      },
    });

    const byReason = new Map<string, { label: string; count: number; amount: number }>();
    for (const o of orders) {
      const label = o.cancelReasonRef?.label ?? o.cancelReason ?? 'Без причины';
      const row = byReason.get(label) ?? { label, count: 0, amount: 0 };
      row.count += 1;
      row.amount += o.total;
      byReason.set(label, row);
    }

    const byWho = new Map<string, number>();
    for (const o of orders) {
      const who = o.cancelledBy ?? 'UNKNOWN';
      byWho.set(who, (byWho.get(who) ?? 0) + 1);
    }

    return {
      from,
      to,
      total: orders.length,
      lostAmount: orders.reduce((s, o) => s + o.total, 0),
      byReason: [...byReason.values()].sort((a, b) => b.count - a.count),
      byWho: Object.fromEntries(byWho),
    };
  }
}
