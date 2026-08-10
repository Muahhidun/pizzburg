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

    if (dto.type === 'DELIVERY' && !dto.address) {
      throw new BadRequestException('Для доставки нужен адрес');
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

    const grossTotal = subtotal + deliveryFee;

    // Акции: подарки клиент не оплачивает; в Poster они уйдут полной
    // ценой и компенсируются «Личной интеграцией»
    let promo = await this.promotions.evaluate(
      tenant.id,
      dto.items,
      dto.promoCode,
    );

    // Клиент по телефону (профиль сохраняется между заказами).
    // Формат единый с OTP, иначе один человек создаёт несколько профилей,
    // а Poster может отклонить заказ из-за невалидного номера.
    const normalizedPhone = normalizeKzPhone(dto.phone);
    const requestedPoints = dto.pointsToSpend ?? 0;
    const loyaltyPolicy = this.loyalty.policy(tenant.settings);
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
      promo = { gifts: [], discount: 0, applied: [] };
    }
    const giftProducts =
      promo.gifts.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: promo.gifts.map((g) => g.productId) } },
          })
        : [];
    const giftById = new Map(giftProducts.map((p) => [p.id, p]));
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
    const pointsSpent = this.loyalty.validateSpend(
      customer.pointsBalance,
      subtotal,
      requestedPoints,
    );
    const total = grossTotal - pointsSpent;

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
          discount: promo.discount + pointsSpent,
          pointsSpent,
          total,
          promoCode: dto.promoCode,
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
      },
    });

    const parts = order.dispatches;
    let remainingPoints = order.pointsSpent;
    const pointsByDispatch = new Map<string, number>();
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
      const allocated = Math.min(remainingPoints, payableInPart);
      pointsByDispatch.set(part.id, allocated);
      remainingPoints -= allocated;
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
      const payNote = {
        CASH: 'Оплата: наличные курьеру',
        CARD_ON_DELIVERY: 'Оплата: карта курьеру (взять терминал)',
        KASPI_ONLINE: 'ОПЛАЧЕНО ОНЛАЙН (Kaspi)',
      }[order.paymentMethod];

      // «Личная интеграция» этой части: подарки + списанные баллы.
      const giftIntegrationSum = items
        .filter((it) => it.isGift)
        .reduce((s, it) => s + it.price * it.qty, 0);
      const pointsIntegrationSum = pointsByDispatch.get(d.id) ?? 0;
      const integrationSum = giftIntegrationSum + pointsIntegrationSum;
      const giftNote = items
        .filter((it) => it.isGift)
        .map((it) => ` | ПОДАРОК ПО АКЦИИ: ${it.name} ×${it.qty} (оплачен интеграцией)`)
        .join('');
      const pointsNote =
        pointsIntegrationSum > 0
          ? ` | БАЛЛЫ ПРИЛОЖЕНИЯ: ${pointsIntegrationSum} ₸ (оплачено интеграцией)`
          : '';

      const addr = order.address as any;

      // Дев-режим: не слать на боевые планшеты
      if (process.env.POSTER_DRY_RUN === '1') {
        this.logger.warn(
          `DRY RUN: заказ №${order.number} часть ${i + 1}/${parts.length} → ` +
            `${d.posterAccount.name}: ${items.map((x) => `${x.name}×${x.qty}`).join(', ')}${partNote}`,
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
