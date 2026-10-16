import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  WoltDriveApiError,
  WoltDriveConfig,
  WoltDriveMode,
  WoltDriveProvider,
  ShipmentPromise,
  woltBaseUrl,
} from './wolt-drive.provider';
import {
  decodeUnverifiedWoltWebhookToken,
  nextWoltDeliveryStatus,
  verifyWoltWebhookToken,
  WoltWebhookPayload,
} from './wolt-drive.webhook';

type WoltOrder = Prisma.OrderGetPayload<{
  include: { customer: true; tenant: true; venue: true };
}>;

type Address = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Wolt принимает цены в наименьших единицах валюты; для KZT это тиыны. */
export function tengeToMinor(amount: number) {
  return Math.round(amount * 100);
}

/**
 * Максимальная цена резервного курьера зависит от итоговой суммы заказа.
 * Суммы заказа хранятся в тенге, цена Wolt — в тиынах.
 */
export function woltDeliveryPriceLimitTenge(orderTotalTenge: number) {
  if (orderTotalTenge >= 8_000) return 2_000;
  if (orderTotalTenge >= 6_000) return 1_500;
  return 1_200;
}

export function assertWoltQuoteWithinLimit(
  quotePriceAmount: number,
  quoteCurrency: string,
  orderTotalTenge: number,
) {
  if (quoteCurrency !== 'KZT') {
    throw new BadRequestException(
      `Wolt Drive вернул неожиданную валюту: ${quoteCurrency}`,
    );
  }
  const maxDeliveryPriceAmount = tengeToMinor(
    woltDeliveryPriceLimitTenge(orderTotalTenge),
  );
  if (quotePriceAmount > maxDeliveryPriceAmount) {
    const quote = Math.ceil(quotePriceAmount / 100)
      .toLocaleString('ru-RU')
      .replace(/\u00a0/g, ' ');
    const limit = Math.ceil(maxDeliveryPriceAmount / 100)
      .toLocaleString('ru-RU')
      .replace(/\u00a0/g, ' ');
    throw new BadRequestException(
      `Стоимость Wolt ${quote} ₸ превышает лимит ${limit} ₸`,
    );
  }
}

export function woltStreet(address: Address) {
  const street = text(address.street);
  const house = text(address.house);
  if (!street || !house) {
    throw new BadRequestException('Для Wolt Drive нужны улица и номер дома');
  }
  return `${street}, ${house}`;
}

export function woltDropoffComment(address: Address, orderComment: string) {
  const parts = [
    text(address.entrance) && `подъезд ${text(address.entrance)}`,
    text(address.floor) && `этаж ${text(address.floor)}`,
    text(address.flat) && `кв. ${text(address.flat)}`,
    text(address.comment),
    orderComment.trim(),
  ].filter(Boolean);
  return parts.join('; ').slice(0, 500);
}

@Injectable()
export class WoltDriveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WoltDriveProvider,
  ) {}

  async publicSettings(tenantId: string) {
    const account = await this.prisma.woltDriveAccount.findUnique({
      where: { tenantId },
    });
    return {
      mode: account?.mode ?? 'disabled',
      merchantKeyConfigured: Boolean(account?.merchantKey),
      merchantKeyHint: account?.merchantKey
        ? `••••${account.merchantKey.slice(-4)}`
        : null,
      merchantId: account?.merchantId ?? '',
      venueId: account?.venueId ?? '',
      city: account?.city ?? '',
      postCode: account?.postCode ?? '',
      webhookConfigured: Boolean(account?.webhookId && account?.webhookSecret),
      webhookId: account?.webhookId ?? '',
      webhookCallbackUrl: account?.webhookCallbackUrl ?? '',
      ready: Boolean(
        account &&
          account.mode !== 'disabled' &&
          account.merchantKey &&
          account.venueId &&
          account.city,
      ),
    };
  }

  async updateSettings(
    tenantId: string,
    dto: {
      mode: 'disabled' | 'test' | 'production';
      merchantKey?: string;
      merchantId?: string;
      venueId: string;
      city: string;
      postCode?: string;
    },
  ) {
    const current = await this.prisma.woltDriveAccount.findUnique({
      where: { tenantId },
    });
    const merchantKey = dto.merchantKey?.trim() || current?.merchantKey || '';
    const venueId = dto.venueId.trim();
    const city = dto.city.trim();
    if (dto.mode !== 'disabled' && (!merchantKey || !venueId || !city)) {
      throw new BadRequestException(
        'Для включения нужны Merchant Key, Venue ID и город',
      );
    }

    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await this.prisma.woltDriveAccount.upsert({
      where: { tenantId },
      create: {
        tenantId,
        mode: dto.mode,
        merchantKey,
        merchantId: dto.merchantId?.trim() || null,
        venueId,
        city,
        postCode: dto.postCode?.trim() || null,
      },
      update: {
        mode: dto.mode,
        merchantKey,
        merchantId: dto.merchantId?.trim() || null,
        venueId,
        city,
        postCode: dto.postCode?.trim() || null,
      },
    });
    return this.publicSettings(tenantId);
  }

  async state(tenantId: string, orderId: string) {
    await this.order(tenantId, orderId);
    const [settings, delivery] = await Promise.all([
      this.publicSettings(tenantId),
      this.prisma.woltDriveDelivery.findUnique({ where: { orderId } }),
    ]);
    return { settings, delivery: delivery ? this.present(delivery) : null };
  }

  async quote(
    tenantId: string,
    orderId: string,
    preparationTimeMinutes: number,
    bagCount: number,
  ) {
    const order = await this.order(tenantId, orderId);
    this.assertOrderCanUseWolt(order);
    const existing = await this.prisma.woltDriveDelivery.findUnique({
      where: { orderId },
    });
    if (existing?.woltOrderReferenceId) return this.present(existing);
    if (existing && ['REQUESTING', 'ERROR'].includes(existing.status)) {
      throw new BadRequestException(
        'Предыдущий вызов Wolt имеет неопределённый результат. Проверьте заказ в Wolt Drive перед повтором',
      );
    }

    const { account, config } = await this.config(tenantId);
    const address = order.address as Address;
    const body = {
      street: woltStreet(address),
      city: account.city,
      ...(account.postCode ? { post_code: account.postCode } : {}),
      ...(number(address.lat) !== undefined && number(address.lng) !== undefined
        ? { lat: number(address.lat), lon: number(address.lng) }
        : {}),
      language: 'ru',
      min_preparation_time_minutes: preparationTimeMinutes,
      parcels: [
        {
          // Это один заказ с общей стоимостью. Физические пакеты
          // передаются отдельно в bag_count, иначе цена умножится.
          count: 1,
          price: { amount: tengeToMinor(order.total), currency: 'KZT' },
        },
      ],
      ...(order.paymentMethod === 'CASH'
        ? { cash: { amount_to_collect: tengeToMinor(order.total) } }
        : {}),
    };

    let promise: ShipmentPromise;
    try {
      promise = await this.provider.forConfig(config).createShipmentPromise(body);
    } catch (error) {
      this.rethrow(error);
    }
    if (!promise.is_binding) {
      throw new BadRequestException(
        'Wolt не смог точно определить адрес. Проверьте улицу и дом',
      );
    }

    const delivery = await this.prisma.woltDriveDelivery.upsert({
      where: { orderId },
      create: {
        tenantId,
        orderId,
        status: 'QUOTED',
        shipmentPromiseId: promise.id,
        promiseValidUntil: new Date(promise.valid_until),
        promiseDropoff: promise.dropoff.location as Prisma.InputJsonValue,
        quotePriceAmount: promise.price.amount,
        quoteCurrency: promise.price.currency,
        quoteIsBinding: promise.is_binding,
        pickupEtaMinutes: promise.pickup.eta_minutes ?? null,
        dropoffEtaMinutes: promise.dropoff.eta_minutes ?? null,
        preparationTimeMinutes,
        bagCount,
        errorCode: null,
        errorMessage: null,
      },
      update: {
        status: 'QUOTED',
        shipmentPromiseId: promise.id,
        promiseValidUntil: new Date(promise.valid_until),
        promiseDropoff: promise.dropoff.location as Prisma.InputJsonValue,
        quotePriceAmount: promise.price.amount,
        quoteCurrency: promise.price.currency,
        quoteIsBinding: promise.is_binding,
        pickupEtaMinutes: promise.pickup.eta_minutes ?? null,
        dropoffEtaMinutes: promise.dropoff.eta_minutes ?? null,
        preparationTimeMinutes,
        bagCount,
        errorCode: null,
        errorMessage: null,
      },
    });
    return this.present(delivery);
  }

  async dispatch(tenantId: string, orderId: string, actorName: string) {
    const order = await this.order(tenantId, orderId);
    this.assertOrderCanUseWolt(order);
    const quoted = await this.prisma.woltDriveDelivery.findUnique({
      where: { orderId },
    });
    if (!quoted) throw new BadRequestException('Сначала рассчитайте доставку');
    if (quoted.woltOrderReferenceId) return this.present(quoted);
    if (quoted.promiseValidUntil.getTime() <= Date.now()) {
      throw new BadRequestException('Расчёт Wolt устарел. Рассчитайте заново');
    }
    if (quoted.status !== 'QUOTED') {
      throw new BadRequestException('Заказ Wolt уже обрабатывается или требует проверки');
    }

    const { config } = await this.config(tenantId);
    assertWoltQuoteWithinLimit(
      quoted.quotePriceAmount,
      quoted.quoteCurrency,
      order.total,
    );

    const claimed = await this.prisma.woltDriveDelivery.updateMany({
      where: { id: quoted.id, status: 'QUOTED', woltOrderReferenceId: null },
      data: { status: 'REQUESTING', requestedBy: actorName },
    });
    if (claimed.count !== 1) {
      const latest = await this.prisma.woltDriveDelivery.findUniqueOrThrow({
        where: { orderId },
      });
      return this.present(latest);
    }

    const address = order.address as Address;
    const promiseLocation = quoted.promiseDropoff as {
      coordinates?: { lat: number; lon: number };
    };
    const support = (order.tenant.settings as any)?.support ?? {};
    const customerSupport = {
      ...(text(support.url) ? { url: text(support.url) } : {}),
      ...(text(support.email) ? { email: text(support.email) } : {}),
      ...(text(support.phone) ? { phone_number: text(support.phone) } : {}),
    };
    const body = {
      pickup: { comment: `Заказ №${order.number}, пакетов: ${quoted.bagCount}` },
      dropoff: {
        location: {
          ...(promiseLocation.coordinates
            ? { coordinates: promiseLocation.coordinates }
            : {}),
        },
        comment: woltDropoffComment(address, order.comment),
        options: { is_no_contact: false },
      },
      recipient: {
        name: order.customer?.name?.trim() || 'Клиент',
        phone_number: order.customer!.phone,
      },
      parcels: [
        {
          count: 1,
          description: `Заказ №${order.number}`,
          identifier: order.id,
          price: { amount: tengeToMinor(order.total), currency: 'KZT' },
        },
      ],
      shipment_promise_id: quoted.shipmentPromiseId,
      ...(Object.keys(customerSupport).length ? { customer_support: customerSupport } : {}),
      merchant_order_reference_id: `${order.tenant.slug}:${order.id}`,
      order_number: String(order.number).slice(-5),
      sms_notifications: {
        // Wolt сам добавляет tracking URL к запрошенному SMS.
        received: `${order.tenant.name}: курьер Wolt назначается.`,
        picked_up: `${order.tenant.name}: курьер забрал заказ.`,
      },
      ...(order.paymentMethod === 'CASH'
        ? {
            cash: {
              amount_to_collect: tengeToMinor(order.total),
              ...(order.changeFrom
                ? { amount_to_expect: tengeToMinor(order.changeFrom) }
                : {}),
            },
          }
        : {}),
      bag_count: quoted.bagCount,
      language: 'ru',
    };

    try {
      const created = await this.provider.forConfig(config).createDelivery(body);
      const delivery = await this.prisma.woltDriveDelivery.update({
        where: { id: quoted.id },
        data: {
          status: created.status || 'INFO_RECEIVED',
          woltOrderReferenceId: created.wolt_order_reference_id,
          trackingUrl: created.tracking?.url ?? null,
          quotePriceAmount: created.price?.amount ?? quoted.quotePriceAmount,
          quoteCurrency: created.price?.currency ?? quoted.quoteCurrency,
          errorCode: null,
          errorMessage: null,
        },
      });
      return this.present(delivery);
    } catch (error) {
      const apiError = error instanceof WoltDriveApiError ? error : null;
      await this.prisma.woltDriveDelivery.update({
        where: { id: quoted.id },
        data: {
          status: 'ERROR',
          errorCode: apiError?.code ?? 'UNKNOWN',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Неизвестная ошибка',
        },
      });
      this.rethrow(error);
    }
  }

  async cancel(tenantId: string, orderId: string, reason: string) {
    const delivery = await this.prisma.woltDriveDelivery.findFirst({
      where: { orderId, tenantId },
    });
    if (!delivery?.woltOrderReferenceId) {
      throw new BadRequestException('Курьер Wolt для этого заказа не вызван');
    }
    if (delivery.status === 'CANCELLED' || delivery.status === 'REJECTED') {
      return this.present(delivery);
    }
    const { config } = await this.config(tenantId);
    try {
      const result = await this.provider
        .forConfig(config)
        .cancelDelivery(delivery.woltOrderReferenceId, reason.trim());
      const updated = await this.prisma.woltDriveDelivery.update({
        where: { id: delivery.id },
        data: { status: result.status || 'REJECTED', errorCode: null, errorMessage: null },
      });
      return this.present(updated);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async registerWebhook(tenantId: string, callbackUrl: string) {
    const { account, config } = await this.config(tenantId);
    if (config.mode !== 'test') {
      throw new BadRequestException(
        'Регистрация webhook пока разрешена только в тестовом контуре',
      );
    }
    if (!account.merchantId) {
      throw new BadRequestException('Для webhook нужен Merchant ID');
    }
    if (account.webhookId) {
      throw new BadRequestException(
        'Webhook уже зарегистрирован. Сначала проверьте существующую настройку Wolt',
      );
    }

    const clientSecret = randomBytes(32).toString('base64url');
    try {
      const created = await this.provider.forConfig(config).createWebhook(
        account.merchantId,
        {
          callback_config: {
            exponential_retry_backoff: { exponent_base: 5, max_retry_count: 3 },
          },
          callback_url: callbackUrl,
          client_secret: clientSecret,
          disabled: false,
        },
      );
      await this.prisma.woltDriveAccount.update({
        where: { tenantId },
        data: {
          webhookId: created.id,
          webhookSecret: clientSecret,
          webhookCallbackUrl: created.callback_url || callbackUrl,
        },
      });
      return this.publicSettings(tenantId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async receiveWebhook(token: string) {
    let unverified: WoltWebhookPayload;
    try {
      unverified = decodeUnverifiedWoltWebhookToken(token);
    } catch {
      throw new UnauthorizedException('Некорректный Wolt webhook');
    }

    const account = await this.webhookAccount(unverified);
    if (!account?.webhookSecret) {
      throw new UnauthorizedException('Wolt webhook не настроен');
    }

    let payload: WoltWebhookPayload;
    try {
      payload = verifyWoltWebhookToken(token, account.webhookSecret);
    } catch {
      throw new UnauthorizedException('Неверная подпись Wolt webhook');
    }
    if (payload.details.venue_id && payload.details.venue_id !== account.venueId) {
      throw new UnauthorizedException('Webhook относится к другой точке Wolt');
    }

    const dispatchedAt = new Date(payload.dispatched_at);
    if (Number.isNaN(dispatchedAt.getTime())) {
      throw new BadRequestException('Некорректное время Wolt webhook');
    }
    const woltReference = payload.details.wolt_order_reference_id || null;
    const merchantReference = payload.details.merchant_order_reference_id || null;
    const delivery = await this.webhookDelivery(
      account.tenantId,
      woltReference,
      merchantReference,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.woltDriveWebhookEvent.create({
          data: {
            tenantId: account.tenantId,
            deliveryId: delivery?.id ?? null,
            eventId: payload.details.id,
            type: payload.type,
            dispatchedAt,
            woltOrderReferenceId: woltReference,
            merchantOrderReferenceId: merchantReference,
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        });
        if (!delivery) return;

        const nextStatus = nextWoltDeliveryStatus(delivery.status, payload.type);
        const pickupEta = this.webhookDate(payload.details.pickup?.eta);
        const dropoffEtaMin = this.webhookDate(payload.details.dropoff?.eta?.min);
        const dropoffEtaMax = this.webhookDate(payload.details.dropoff?.eta?.max);
        const deliveredAt = this.webhookDate(payload.details.dropoff?.completed_at);
        await tx.woltDriveDelivery.update({
          where: { id: delivery.id },
          data: {
            status: nextStatus,
            ...(pickupEta ? { pickupEta } : {}),
            ...(dropoffEtaMin ? { dropoffEtaMin } : {}),
            ...(dropoffEtaMax ? { dropoffEtaMax } : {}),
            ...(deliveredAt ? { deliveredAt } : {}),
            ...(payload.details.courier?.vehicle_type
              ? { courierVehicleType: payload.details.courier.vehicle_type }
              : {}),
            ...(payload.details.pin_code
              ? { handshakePin: payload.details.pin_code }
              : {}),
            ...(payload.details.purchase_rejected_reason
              ? {
                  errorCode: payload.details.purchase_rejected_reason,
                  errorMessage: 'Wolt отклонил доставку',
                }
              : {}),
          },
        });
      });
      return { received: true, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  private async order(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { customer: true, tenant: true, venue: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  private assertOrderCanUseWolt(order: WoltOrder) {
    if (order.type !== 'DELIVERY') {
      throw new BadRequestException('Wolt Drive доступен только для доставки');
    }
    if (['CANCELLED', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }
    if (!order.customer?.phone || !order.address) {
      throw new BadRequestException('В заказе нет телефона или адреса клиента');
    }
    if (order.paymentMethod === 'CARD_ON_DELIVERY') {
      throw new BadRequestException(
        'Для оплаты картой при получении нужен терминал заведения; у курьера Wolt его нет. Выберите собственного курьера',
      );
    }
    if (order.paymentMethod === 'KASPI_ONLINE' && order.paymentStatus !== 'PAID') {
      throw new BadRequestException('Онлайн-оплата ещё не подтверждена');
    }
  }

  private async config(tenantId: string): Promise<{
    account: {
      mode: string;
      merchantKey: string;
      merchantId: string | null;
      venueId: string;
      city: string;
      postCode: string | null;
      webhookId: string | null;
      webhookSecret: string | null;
    };
    config: WoltDriveConfig;
  }> {
    const account = await this.prisma.woltDriveAccount.findUnique({ where: { tenantId } });
    if (
      !account ||
      !['test', 'production'].includes(account.mode) ||
      !account.merchantKey ||
      !account.venueId ||
      !account.city
    ) {
      throw new ServiceUnavailableException(
        'Wolt Drive ещё не настроен: нужны тестовые Merchant Key и Venue ID',
      );
    }
    const mode = account.mode as WoltDriveMode;
    return {
      account,
      config: {
        mode,
        merchantKey: account.merchantKey,
        venueId: account.venueId,
        baseUrl: woltBaseUrl(mode),
        timeoutMs: Math.min(60_000, Math.max(1_000, Number(process.env.WOLT_DRIVE_TIMEOUT_MS) || 15_000)),
      },
    };
  }

  private present(delivery: {
    id: string;
    status: string;
    promiseValidUntil: Date;
    quotePriceAmount: number;
    quoteCurrency: string;
    quoteIsBinding: boolean;
    pickupEtaMinutes: number | null;
    dropoffEtaMinutes: number | null;
    preparationTimeMinutes: number;
    bagCount: number;
    woltOrderReferenceId: string | null;
    trackingUrl: string | null;
    pickupEta: Date | null;
    dropoffEtaMin: Date | null;
    dropoffEtaMax: Date | null;
    deliveredAt: Date | null;
    courierVehicleType: string | null;
    handshakePin: string | null;
    requestedBy: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: Date;
  }) {
    return {
      ...delivery,
      promiseValidUntil: delivery.promiseValidUntil.toISOString(),
      pickupEta: delivery.pickupEta?.toISOString() ?? null,
      dropoffEtaMin: delivery.dropoffEtaMin?.toISOString() ?? null,
      dropoffEtaMax: delivery.dropoffEtaMax?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  private async webhookAccount(payload: WoltWebhookPayload) {
    if (payload.details.venue_id) {
      const matches = await this.prisma.woltDriveAccount.findMany({
        where: { venueId: payload.details.venue_id, webhookSecret: { not: null } },
        take: 2,
      });
      return matches.length === 1 ? matches[0] : null;
    }
    const reference = payload.details.merchant_order_reference_id;
    const tenantSlug = reference?.split(':', 1)[0];
    if (!tenantSlug) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: { woltDriveAccount: true },
    });
    return tenant?.woltDriveAccount ?? null;
  }

  private async webhookDelivery(
    tenantId: string,
    woltReference: string | null,
    merchantReference: string | null,
  ) {
    if (woltReference) {
      const delivery = await this.prisma.woltDriveDelivery.findFirst({
        where: { tenantId, woltOrderReferenceId: woltReference },
      });
      if (delivery) return delivery;
    }
    const orderId = merchantReference?.split(':').slice(1).join(':');
    if (!orderId) return null;
    return this.prisma.woltDriveDelivery.findFirst({
      where: { tenantId, orderId },
    });
  }

  private webhookDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private rethrow(error: unknown): never {
    if (error instanceof WoltDriveApiError) {
      const message = error.code ? `${error.message} (${error.code})` : error.message;
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw new BadRequestException(`Wolt Drive: ${message}`);
      }
      throw new ServiceUnavailableException(`Wolt Drive: ${message}`);
    }
    throw new ServiceUnavailableException('Wolt Drive временно недоступен');
  }
}
