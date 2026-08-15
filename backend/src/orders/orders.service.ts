import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from '../poster/poster.client';
import { PromotionsService } from '../promotions/promotions.service';
import { CreateOrderDto } from './orders.dto';
import { normalizeKzPhone } from '../common/phone';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { OrderStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { AvailabilityService } from '../availability/availability.service';
import { CancelReasonsService } from './cancel-reasons.service';
import { LegalService } from '../legal/legal.service';
import { AddressesService } from '../auth/addresses.service';

interface DeliverySettings {
  minOrder: number;
  fee: number;
  freeFrom: number;
}

/**
 * Ядро заказов.
 *
 * Сходимость кассы (главный инвариант): все позиции уходят в Poster по
 * полным кассовым ценам. Скидочная часть (акции, баллы, промокоды) и
 * онлайн-оплата передаются предоплатой payment{sum} — в чеке Poster это
 * «Личная интеграция». Остаток кассир закрывает реальным методом. Тогда
 * выручка Poster сходится с деньгами при закрытии смены.
 *
 * Заказ из двух отделов расщепляется на OrderDispatch — по одному
 * входящему заказу в каждый аккаунт Poster, с пометкой «часть X/Y» в
 * комментарии, чтобы отделы знали об общем заказе.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
    private readonly promotions: PromotionsService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly availability: AvailabilityService,
    private readonly cancelReasons: CancelReasonsService,
    private readonly legal: LegalService,
    private readonly addresses: AddressesService,
  ) {}

  async createOrder(
    tenantSlug: string,
    dto: CreateOrderDto,
    authCustomer?: { sub: string; tenantId: string; phone: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: { venues: { where: { isActive: true }, take: 1 } },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    const venue = tenant.venues[0];
    if (!venue) throw new BadRequestException('Нет активной точки');

    if (dto.paymentMethod === 'KASPI_ONLINE') {
      throw new BadRequestException('Kaspi онлайн ещё не подключён');
    }

    // Режим приёма, расписание, предзаказ и включённые способы оплаты.
    // Клиент прячет недоступные варианты, но решает сервер.
    const availability = this.availability.assertOrderAllowed(tenant.settings, {
      type: dto.type,
      paymentMethod: dto.paymentMethod,
      scheduledAt: dto.scheduledAt,
    });

    if (dto.type === 'DELIVERY' && !dto.address) {
      throw new BadRequestException('Для доставки нужен адрес');
    }

    // «Сдача с» имеет смысл только для наличных
    if (dto.changeFrom != null) {
      if (dto.paymentMethod !== 'CASH') {
        throw new BadRequestException('Сдача указывается только при оплате наличными');
      }
      if (!availability.payments.askChangeFrom) {
        throw new BadRequestException('Уточнение сдачи отключено');
      }
    }

    // Загружаем товары корзины и проверяем доступность
    const ids = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, tenantId: tenant.id },
      include: { posterAccount: true, category: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      const p = byId.get(item.productId);
      if (!p || !p.isVisible || !p.posterAccount.isActive) {
        throw new BadRequestException(`Товар недоступен: ${item.productId}`);
      }
      if (!p.isActive || !p.category.isActive) {
        throw new BadRequestException(
          `«${p.displayName ?? p.name}» сейчас в стоп-листе`,
        );
      }
    }

    // Расчёт. Цена клиента = priceOverride ?? кассовая цена.
    let subtotal = 0;
    for (const item of dto.items) {
      const p = byId.get(item.productId)!;
      const unit =
        (p.priceOverride ?? p.price) +
        (item.modifiers?.reduce((s, m) => s + m.price, 0) ?? 0);
      subtotal += unit * item.qty;
    }

    const settings = (tenant.settings as any)?.delivery as
      | DeliverySettings
      | undefined;
    const delivery: DeliverySettings = {
      minOrder: settings?.minOrder ?? 0,
      fee: settings?.fee ?? 0,
      freeFrom: settings?.freeFrom ?? Infinity,
    };

    let deliveryFee = 0;
    if (dto.type === 'DELIVERY') {
      if (subtotal < delivery.minOrder) {
        throw new BadRequestException(
          `Минимальная сумма для доставки — ${delivery.minOrder} ₸ (доступен самовывоз)`,
        );
      }
      deliveryFee = subtotal >= delivery.freeFrom ? 0 : delivery.fee;
    }


    const legalVersions = await this.legal.currentVersions(tenant.id);

    // Клиент по телефону (профиль сохраняется между заказами).
    // Формат единый с OTP, иначе один человек создаёт несколько профилей,
    // а Poster может отклонить заказ из-за невалидного номера.
    const normalizedPhone = normalizeKzPhone(dto.phone);
    const requestedPoints = dto.pointsToSpend ?? 0;
    const loyaltyPolicy = this.loyalty.policy(tenant.settings);
    if (
      requestedPoints > 0 &&
      (!authCustomer ||
        authCustomer.tenantId !== tenant.id ||
        authCustomer.phone !== normalizedPhone)
    ) {
      throw new BadRequestException(
        'Чтобы использовать баллы, войдите по номеру из заказа',
      );
    }
    let customer = authCustomer
      ? await this.prisma.customer.findFirst({
          where: {
            id: authCustomer.sub,
            tenantId: tenant.id,
            phone: normalizedPhone,
          },
        })
      : await this.prisma.customer.upsert({
          where: {
            tenantId_phone: { tenantId: tenant.id, phone: normalizedPhone },
          },
          create: {
            tenantId: tenant.id,
            phone: normalizedPhone,
            name: dto.name,
          },
          update: dto.name ? { name: dto.name } : {},
        });
    if (!customer) {
      throw new BadRequestException('Номер заказа не совпадает с профилем');
    }
    if (authCustomer && dto.name && customer.name !== dto.name) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { name: dto.name },
      });
    }
    // Акции считаем после клиента: ограничения «первый заказ», «раз на
    // клиента» и лимит применений без него не проверить.
    const ordersBefore = await this.prisma.order.count({
      where: { customerId: customer.id },
    });
    let promo = await this.promotions.evaluate(
      tenant.id,
      dto.items,
      dto.promoCode,
      {
        subtotal,
        orderType: dto.type,
        customerId: customer.id,
        isFirstOrder: ordersBefore === 0,
      },
    );

    if (
      requestedPoints > 0 &&
      promo.applied.length > 0 &&
      !loyaltyPolicy.allowPointsWithPromotions
    ) {
      if (!dto.skipPromotions) {
        throw new BadRequestException(
          'Баллы нельзя использовать вместе с акцией. Выберите акцию или баллы',
        );
      }
      promo = {
        gifts: [],
        giftValue: 0,
        moneyDiscount: 0,
        freeDelivery: false,
        applied: [],
        appliedPromotions: [],
        nextGift: null,
      };
    }
    const giftProducts =
      promo.gifts.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: promo.gifts.map((g) => g.productId) } },
          })
        : [];
    const giftById = new Map(giftProducts.map((p) => [p.id, p]));

    // Бесплатная доставка по акции применяется к уже посчитанной цене
    if (promo.freeDelivery) deliveryFee = 0;

    // Денежная скидка уменьшает сумму к оплате — в отличие от подарка,
    // за который клиент просто не платит. В Poster она уходит той же
    // «Личной интеграцией», что и баллы, иначе смена не сойдётся.
    const moneyDiscount = Math.min(promo.moneyDiscount, subtotal);
    const payableBeforePoints = subtotal + deliveryFee - moneyDiscount;

    const pointsSpent = this.loyalty.validateSpend(
      customer.pointsBalance,
      payableBeforePoints,
      requestedPoints,
    );
    const total = payableBeforePoints - pointsSpent;

    // Заказ + позиции + отправки в транзакции
    const order = await this.prisma.$transaction(async (tx) => {
      const last = await tx.order.aggregate({
        where: { tenantId: tenant.id },
        _max: { number: true },
      });
      const created = await tx.order.create({
        data: {
          tenantId: tenant.id,
          venueId: venue.id,
          customerId: customer.id,
          number: (last._max.number ?? 0) + 1,
          type: dto.type,
          address: dto.address ? { ...dto.address } : undefined,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          comment: dto.comment ?? '',
          subtotal,
          deliveryFee,
          // Вся выгода клиента одной строкой: подарки, денежная скидка
          // и баллы. Ровно эта сумма гасится «Личной интеграцией».
          discount: promo.giftValue + moneyDiscount + pointsSpent,
          promoDiscount: moneyDiscount,
          pointsSpent,
          total,
          promoCode: dto.promoCode,
          changeFrom: dto.changeFrom ?? null,
          // Снимок действующих редакций: при споре видно, с какой
          // версией оферты клиент оформлял именно этот заказ
          legalVersions: legalVersions as object,
          paymentMethod: dto.paymentMethod,
          paymentStatus:
            dto.paymentMethod === 'KASPI_ONLINE' ? 'PENDING' : 'NOT_REQUIRED',
          items: {
            create: [
              ...dto.items.map((i) => {
                const p = byId.get(i.productId)!;
                return {
                  productId: p.id,
                  name: p.displayName ?? p.name,
                  price: p.priceOverride ?? p.price,
                  qty: i.qty,
                  modifiers: (i.modifiers ?? []).map((m) => ({
                    ...(m.posterId ? { posterId: m.posterId } : {}),
                    name: m.name,
                    price: m.price,
                    ...(m.qty ? { qty: m.qty } : {}),
                  })),
                };
              }),
              ...promo.gifts.map((g) => ({
                productId: g.productId,
                name: g.name,
                price: g.price, // полная цена — для Poster и интеграции
                qty: g.qty,
                isGift: true,
              })),
            ],
          },
        },
        include: { items: true },
      });

      await this.loyalty.spendForOrder(tx, {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: created.id,
        orderNumber: created.number,
        amount: pointsSpent,
      });

      // Расщепление по отделам (включая отделы подарочных позиций)
      const accountIds = [
        ...new Set([
          ...dto.items.map((i) => byId.get(i.productId)!.posterAccountId),
          ...promo.gifts.map((g) => giftById.get(g.productId)!.posterAccountId),
        ]),
      ];
      for (const accId of accountIds) {
        await tx.orderDispatch.create({
          data: { orderId: created.id, posterAccountId: accId },
        });
      }
      return created;
    });

    // Фиксируем применения акций: на них держатся лимиты «первый заказ»
    // и «раз на клиента». Ключ (акция, заказ) уникален, поэтому повтор
    // не съедает лимит дважды.
    await this.promotions.recordUses(
      tenant.id,
      order.id,
      customer.id,
      promo.appliedPromotions,
    );

    // Адрес запоминаем вне транзакции: справочник для следующего заказа —
    // удобство, и его сбой не должен отменять уже принятый заказ.
    if (dto.type === 'DELIVERY' && dto.address && customer.id) {
      try {
        await this.addresses.remember(tenant.id, customer.id, dto.address);
      } catch (error) {
        this.logger.warn(`Не удалось запомнить адрес заказа: ${String(error)}`);
      }
    }

    // Отправка на планшеты — вне транзакции (сетевые вызовы)
    await this.dispatchToPoster(order.id);

    const fresh = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { dispatches: { include: { posterAccount: true } } },
    });
    return {
      id: fresh.id,
      number: fresh.number,
      subtotal,
      deliveryFee,
      total,
      pointsSpent,
      dispatches: fresh.dispatches.map((d) => ({
        department: d.posterAccount.name,
        status: d.status,
      })),
    };
  }

  /** Отправляет каждую часть заказа в свой аккаунт Poster */
  async dispatchToPoster(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        dispatches: {
          include: { posterAccount: true },
          orderBy: { posterAccount: { sortOrder: 'asc' } },
        },
        customer: true,
        tenant: { select: { settings: true } },
      },
    });

    const parts = order.dispatches;
    // Предоплата «Личной интеграцией» — это баллы И денежная скидка по
    // акциям: и то, и другое клиент не платит наличными, но в кассе
    // позиции стоят полную цену.
    let remainingPrepaid = order.pointsSpent + order.promoDiscount;
    const prepaidByDispatch = new Map<string, number>();
    for (const part of parts) {
      const payableInPart = order.items
        .filter(
          (it) =>
            !it.isGift && it.product?.posterAccountId === part.posterAccountId,
        )
        .reduce((sum, it) => {
          const modifierTotal = ((it.modifiers as any[]) ?? []).reduce(
            (modifierSum, modifier) =>
              modifierSum + Number(modifier.price ?? 0) * Number(modifier.qty ?? 1),
            0,
          );
          return sum + (it.price + modifierTotal) * it.qty;
        }, 0);
      const allocated = Math.min(remainingPrepaid, payableInPart);
      prepaidByDispatch.set(part.id, allocated);
      remainingPrepaid -= allocated;
    }
    for (let i = 0; i < parts.length; i++) {
      const d = parts[i];
      if (d.status === 'SENT') continue;

      const items = order.items.filter(
        (it) => it.product?.posterAccountId === d.posterAccountId,
      );
      const partNote =
        parts.length > 1
          ? ` | ОБЩИЙ ЗАКАЗ №${order.number}: часть ${i + 1}/${parts.length} (${parts
              .filter((p) => p.id !== d.id)
              .map((p) => p.posterAccount.name)
              .join(', ')})`
          : '';
      // Сдачу показываем только на первой части: разменивает один кассир,
      // а видеть строку на обоих планшетах — путаница.
      const changeNote =
        i === 0 && order.paymentMethod === 'CASH' && order.changeFrom
          ? ` (готовить сдачу с ${order.changeFrom} ₸)`
          : '';
      const payNote =
        {
          CASH: 'Оплата: наличные курьеру',
          CARD_ON_DELIVERY: 'Оплата: карта курьеру (взять терминал)',
          KASPI_ONLINE: 'ОПЛАЧЕНО ОНЛАЙН (Kaspi)',
        }[order.paymentMethod] + changeNote;

      const scheduledNote = order.scheduledAt
        ? ` | ПРЕДЗАКАЗ на ${new Intl.DateTimeFormat('ru-RU', {
            timeZone:
              (order.tenant?.settings as any)?.timezone ?? 'Asia/Almaty',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(order.scheduledAt)}`
        : '';

      // «Личная интеграция» этой части: подарки + списанные баллы.
      const giftIntegrationSum = items
        .filter((it) => it.isGift)
        .reduce((s, it) => s + it.price * it.qty, 0);
      const prepaidIntegrationSum = prepaidByDispatch.get(d.id) ?? 0;
      const integrationSum = giftIntegrationSum + prepaidIntegrationSum;
      const giftNote = items
        .filter((it) => it.isGift)
        .map((it) => ` | ПОДАРОК ПО АКЦИИ: ${it.name} ×${it.qty} (оплачен интеграцией)`)
        .join('');
      // Кассиру важно видеть, чем закрыта разница: баллами клиента или
      // скидкой по акции — это разные разговоры при спорах.
      const pointsNote =
        prepaidIntegrationSum > 0
          ? ` | ${
              order.promoDiscount > 0 && order.pointsSpent > 0
                ? 'БАЛЛЫ И СКИДКА'
                : order.promoDiscount > 0
                  ? 'СКИДКА ПО АКЦИИ'
                  : 'БАЛЛЫ ПРИЛОЖЕНИЯ'
            }: ${prepaidIntegrationSum} ₸ (оплачено интеграцией)`
          : '';

      const addr = order.address as any;

      // Дев-режим: не слать на боевые планшеты
      if (process.env.POSTER_DRY_RUN === '1') {
        this.logger.warn(
          `DRY RUN: заказ №${order.number} часть ${i + 1}/${parts.length} → ` +
            `${d.posterAccount.name}: ${items.map((x) => `${x.name}×${x.qty}`).join(', ')}${partNote}` +
            // Комментарий кассира целиком: по нему проверяем сдачу,
            // предзаказ и пометки подарков перед боевым тестом
            `\n  комментарий кассиру: ${payNote}.${order.comment ? ` ${order.comment}` : ''}${scheduledNote}${giftNote}${pointsNote}`,
        );
        await this.prisma.orderDispatch.update({
          where: { id: d.id },
          data: { status: 'SENT', posterOrderId: 'dry-run' },
        });
        continue;
      }

      try {
        const res = await this.poster.createIncomingOrder(
          d.posterAccount.token,
          {
            spot_id: 1,
            phone: order.customer?.phone ?? '',
            service_mode: order.type === 'DELIVERY' ? 3 : 2,
            comment:
              `Заказ из приложения №${order.number}. ${payNote}.` +
              (order.comment ? ` ${order.comment}` : '') +
              scheduledNote +
              giftNote +
              pointsNote +
              partNote,
            client_address:
              order.type === 'DELIVERY' && addr
                ? {
                    address1: `${addr.street}, ${addr.house}`,
                    address2: [
                      addr.entrance && `подъезд ${addr.entrance}`,
                      addr.floor && `этаж ${addr.floor}`,
                      addr.flat && `кв. ${addr.flat}`,
                    ]
                      .filter(Boolean)
                      .join(', '),
                    comment: addr.comment,
                  }
                : undefined,
            products: items.map((it) => {
              const selected = (it.modifiers as any[]) ?? [];
              const posterMods = selected.filter((m) => m.posterId);
              return {
                product_id: Number(it.product!.posterId),
                count: it.qty,
                // выбор в наборах тех.карты: [{m: dish_modification_id, a: кол-во}]
                modification:
                  posterMods.length > 0
                    ? JSON.stringify(
                        posterMods.map((m) => ({ m: Number(m.posterId), a: m.qty ?? 1 })),
                      )
                    : undefined,
              };
            }),
            // Стоимость доставки вешаем на первую часть, чтобы не задвоить
            delivery_price:
              i === 0 && order.deliveryFee > 0
                ? order.deliveryFee * 100
                : undefined,
            payment:
              integrationSum > 0
                ? { type: 1, sum: integrationSum * 100, currency: 'KZT' }
                : undefined,
          },
        );
        await this.prisma.orderDispatch.update({
          where: { id: d.id },
          data: {
            status: 'SENT',
            posterOrderId: String(res.incoming_order_id),
            error: null,
          },
        });
      } catch (e) {
        this.logger.error(`Dispatch ${d.id} failed: ${e}`);
        await this.prisma.orderDispatch.update({
          where: { id: d.id },
          data: { status: 'FAILED', error: String(e) },
        });
      }
    }
  }

  /**
   * Подтягивает статусы частей заказа с планшетов Poster и агрегирует
   * статус заказа. Пуш клиенту (позже) триггерится «главным» отделом:
   * при общем заказе — основной (меньший sortOrder аккаунта).
   */
  async syncStatus(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { dispatches: { include: { posterAccount: true } } },
    });

    const map: Record<number, string> = { 0: 'NEW', 1: 'ACCEPTED', 7: 'REJECTED' };
    for (const d of order.dispatches) {
      if (d.status !== 'SENT' || !d.posterOrderId || d.posterOrderId === 'dry-run')
        continue;
      try {
        const res = await this.poster.getIncomingOrder(
          d.posterAccount.token,
          d.posterOrderId,
        );
        await this.prisma.orderDispatch.update({
          where: { id: d.id },
          data: { posterStatus: map[res.status] ?? `UNKNOWN_${res.status}` },
        });
      } catch (e) {
        this.logger.warn(`Status sync failed for dispatch ${d.id}: ${e}`);
      }
    }

    const fresh = await this.prisma.orderDispatch.findMany({
      where: { orderId },
      include: { posterAccount: { select: { name: true, sortOrder: true } } },
      orderBy: { posterAccount: { sortOrder: 'asc' } },
    });

    // Главный отдел = первый по sortOrder среди частей заказа
    const main = fresh[0];
    let orderStatus = order.status;
    if (fresh.every((d) => d.posterStatus === 'REJECTED')) {
      orderStatus = 'CANCELLED';
    } else if (main?.posterStatus === 'ACCEPTED' && order.status === 'NEW') {
      orderStatus = 'ACCEPTED';
    }
    if (orderStatus !== order.status) await this.setStatus(orderId, orderStatus as OrderStatus);

    return {
      orderId,
      status: orderStatus,
      parts: fresh.map((d) => ({
        department: d.posterAccount.name,
        posterOrderId: d.posterOrderId,
        posterStatus: d.posterStatus,
      })),
    };
  }

  /** Ручное продвижение статуса; DELIVERED начисляет кэшбэк, CANCELLED возвращает списание. */
  /**
   * Отмена заказа самим клиентом в отведённое окно.
   *
   * Окно намеренно короткое: пока кассир не принял заказ на планшете,
   * отмена бесплатна для всех. Возврат баллов делает LoyaltyService
   * через общий обработчик статуса.
   */
  async cancelByCustomer(
    orderId: string,
    customerId: string,
    reason: string | undefined,
    reasonId?: string,
    now = new Date(),
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { tenant: { select: { settings: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.status === 'CANCELLED') {
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }

    const { cancellation } = this.availability.getState(order.tenant.settings, now);
    if (cancellation.customerWindowMinutes <= 0) {
      throw new BadRequestException(
        'Отмена из приложения недоступна — позвоните нам, пожалуйста',
      );
    }

    // Принятый кассиром заказ клиент уже не отменяет сам: еда могла
    // уйти в работу, и списание должен разбирать оператор.
    if (order.status !== 'NEW') {
      throw new BadRequestException(
        'Заказ уже принят — отмену нужно согласовать с оператором',
      );
    }

    const deadline = new Date(
      order.createdAt.getTime() + cancellation.customerWindowMinutes * 60_000,
    );
    if (now > deadline) {
      throw new BadRequestException(
        `Отменить можно в течение ${cancellation.customerWindowMinutes} минут после оформления`,
      );
    }

    // Причина из справочника — иначе отчёт по отменам не сгруппировать
    const label = reasonId
      ? await this.cancelReasons.resolve(order.tenantId, reasonId, true)
      : null;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        cancelReasonId: reasonId ?? null,
        cancelReason: reason?.slice(0, 300) || label || 'Отменён клиентом',
        cancelledBy: 'CUSTOMER',
        cancelledAt: now,
      },
    });
    return this.setStatus(order.id, 'CANCELLED', order.tenantId);
  }

  /**
   * Отмена оператором из ленты заказов.
   *
   * Отдельный метод, а не смена статуса на CANCELLED: без причины из
   * справочника отчёт по отменам превращается в число без разбивки, ради
   * которой он и делался. Окно отмены на оператора не распространяется —
   * он отменяет и принятый, и готовящийся заказ.
   */
  async cancelByOperator(
    orderId: string,
    tenantId: string,
    reasonId: string,
    comment?: string,
    now = new Date(),
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === 'CANCELLED') {
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }

    // Оператору доступны все причины, включая внутренние
    // («нет курьеров», «нет позиции») — их клиент выбирать не должен.
    const label = await this.cancelReasons.resolve(tenantId, reasonId, false);

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        cancelReasonId: reasonId,
        cancelReason: comment?.slice(0, 300) || label,
        // Именно ADMIN, а не OPERATOR: значение уже зафиксировано схемой и
        // отчётом по отменам, второе написание разбило бы разбивку надвое.
        cancelledBy: 'ADMIN',
        cancelledAt: now,
      },
    });
    return this.setStatus(order.id, 'CANCELLED', tenantId);
  }

  async setStatus(orderId: string, next: OrderStatus, tenantId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...(tenantId ? { tenantId } : {}) },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === next) {
      // Повторный запрос безопасно завершает начисление/возврат после временного
      // сбоя между сохранением статуса и записью операции лояльности.
      await this.loyalty.onStatusChanged(order.id, next);
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }
    const allowed: Record<OrderStatus, OrderStatus[]> = {
      NEW: ['ACCEPTED', 'CANCELLED'],
      ACCEPTED: ['COOKING', 'READY', 'ON_WAY', 'DELIVERED', 'CANCELLED'],
      COOKING: ['READY', 'ON_WAY', 'DELIVERED', 'CANCELLED'],
      READY: ['ON_WAY', 'DELIVERED', 'CANCELLED'],
      ON_WAY: ['DELIVERED', 'CANCELLED'],
      DELIVERED: [],
      CANCELLED: [],
    };
    if (!allowed[order.status].includes(next)) {
      throw new BadRequestException(
        `Нельзя изменить статус ${order.status} на ${next}`,
      );
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: next },
    });
    await this.loyalty.onStatusChanged(order.id, next);
    await this.notifications.sendOrderStatus(order.id, next);
    return this.prisma.order.findUniqueOrThrow({ where: { id: updated.id } });
  }

  /**
   * Последний заказ клиента для блока «Тот же заказ?».
   *
   * Отменённые не предлагаем: человек их отменил, повторять незачем.
   */
  async lastOrder(tenantId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { tenantId, customerId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          where: { isGift: false },
          include: {
            product: {
              select: { displayPhotoUrl: true, photoUrl: true },
            },
          },
        },
      },
    });
    if (!order) return null;

    const items = order.items;
    return {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      total: order.total,
      type: order.type,
      positions: items.reduce((sum, i) => sum + i.qty, 0),
      // Состав одной строкой — как в хендоффе: «Маргарита, Комбо Хот-Дог»
      summary: items.map((i) => i.name).join(', '),
      photoUrl:
        items[0]?.product?.displayPhotoUrl ?? items[0]?.product?.photoUrl ?? null,
    };
  }

  /**
   * Собирает корзину из прошлого заказа.
   *
   * Позиции пересобираются по **текущему** меню, а не по снимку заказа:
   * цены могли измениться, и человек платит сегодняшнюю. Подарки по акциям
   * не переносятся — их заново выдаст промо-движок, если условие снова
   * выполнено; иначе клиент увидел бы подарок, на который не заработал.
   */
  async repeatOrder(orderId: string, tenantId: string, customerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, customerId },
      include: { items: { where: { isGift: false } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const ids = order.items
      .map((i) => i.productId)
      .filter((id): id is string => id !== null);
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, tenantId },
      include: { category: true, posterAccount: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items: {
      productId: string;
      qty: number;
      modifiers: unknown;
    }[] = [];
    const unavailable: { name: string; reason: string }[] = [];

    for (const item of order.items) {
      const product = item.productId ? byId.get(item.productId) : undefined;
      if (!product || !product.isVisible) {
        unavailable.push({ name: item.name, reason: 'больше нет в меню' });
        continue;
      }
      if (!product.isActive || !product.category.isActive) {
        unavailable.push({ name: item.name, reason: 'сегодня закончилось' });
        continue;
      }
      if (!product.posterAccount.isActive) {
        unavailable.push({ name: item.name, reason: 'отдел не работает' });
        continue;
      }
      items.push({
        productId: product.id,
        qty: item.qty,
        modifiers: item.modifiers,
      });
    }

    return { items, unavailable };
  }

  async getOrder(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        dispatches: { include: { posterAccount: { select: { name: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Заказ не найден');
    return o;
  }
}
