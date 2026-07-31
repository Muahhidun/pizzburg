import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from '../poster/poster.client';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  PosterAccountDto,
  PromotionDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateSettingsDto,
} from './admin.dto';

/**
 * Админка владельца. Правит ТОЛЬКО витринные поля — данные, приходящие
 * синком из Poster (name, price, isActive, категория кассы), неизменны.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
    private readonly storage: ObjectStorageService,
  ) {}

  private async tenant(slug = 'pizzburg') {
    const t = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!t) throw new NotFoundException('Unknown tenant');
    return t;
  }

  /** Полная витрина, включая скрытое (в отличие от публичного /menu) */
  async storefront(slug?: string) {
    const tenant = await this.tenant(slug);
    const categories = await this.prisma.appCategory.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          orderBy: [
            { sortOverride: { sort: 'asc', nulls: 'last' } },
            { sortOrder: 'asc' },
          ],
          include: {
            posterAccount: { select: { id: true, name: true } },
            category: { select: { name: true, isActive: true } },
          },
        },
      },
    });

    return {
      tenantId: tenant.id,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        isVisible: c.isVisible,
        productsTotal: c.products.length,
        productsVisible: c.products.filter(
          (p) => p.isVisible && p.isActive && p.category.isActive,
        ).length,
        products: c.products.map((p) => ({
          id: p.id,
          name: p.name, // из кассы
          displayName: p.displayName,
          description: p.description,
          displayDescription: p.displayDescription,
          photoUrl: p.photoUrl,
          displayPhotoUrl: p.displayPhotoUrl,
          weightLabel: p.weightLabel,
          isHit: p.isHit,
          isSpicy: p.isSpicy,
          isNew: p.isNew,
          price: p.price, // из кассы
          priceOverride: p.priceOverride,
          isVisible: p.isVisible,
          inStopList: !p.isActive || !p.category.isActive,
          department: p.posterAccount.name,
          posterCategory: p.category.name,
          hasModifiers:
            Array.isArray(p.modifiers) && (p.modifiers as unknown[]).length > 0,
        })),
      })),
    };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    return this.prisma.appCategory.update({
      where: { id },
      data: { ...dto, name: dto.name?.trim() },
    });
  }

  async reorderCategories(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.appCategory.update({
          where: { id },
          data: { sortOrder: i + 1 },
        }),
      ),
    );
    return { ok: true, count: ids.length };
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const previous =
      dto.displayPhotoUrl !== undefined
        ? await this.prisma.product.findUnique({
            where: { id },
            select: { displayPhotoUrl: true },
          })
        : null;
    // пустая строка от формы = сброс оверрайда
    const data = {
      ...dto,
      displayName:
        dto.displayName === '' ? null : dto.displayName?.trim(),
      displayDescription:
        dto.displayDescription === ''
          ? null
          : dto.displayDescription?.trim(),
      displayPhotoUrl:
        dto.displayPhotoUrl === '' ? null : dto.displayPhotoUrl?.trim(),
      weightLabel: dto.weightLabel === '' ? null : dto.weightLabel?.trim(),
    };
    const updated = await this.prisma.product.update({ where: { id }, data });
    if (
      previous?.displayPhotoUrl &&
      previous.displayPhotoUrl !== updated.displayPhotoUrl
    ) {
      await this.storage.deleteIfManaged(previous.displayPhotoUrl);
    }
    return updated;
  }

  async uploadProductPhoto(id: string, file: Express.Multer.File) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, displayPhotoUrl: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const displayPhotoUrl = await this.storage.uploadProductImage(id, file);
    try {
      await this.prisma.product.update({
        where: { id },
        data: { displayPhotoUrl },
      });
    } catch (error) {
      await this.storage.deleteIfManaged(displayPhotoUrl);
      throw error;
    }

    await this.storage.deleteIfManaged(product.displayPhotoUrl);
    return { displayPhotoUrl };
  }

  async reorderProducts(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.product.update({
          where: { id },
          data: { sortOverride: i + 1 },
        }),
      ),
    );
    return { ok: true, count: ids.length };
  }

  async orders(params: { date?: string; status?: string }) {
    const tenant = await this.tenant();
    // Дата приходит как YYYY-MM-DD и означает КАЛЕНДАРНЫЙ ДЕНЬ ЗАВЕДЕНИЯ:
    // парсим по локальному времени сервера, не по UTC (иначе ночные
    // заказы попадают в соседние сутки).
    const from = new Date();
    if (params.date) {
      const [y, m, d] = params.date.split('-').map(Number);
      from.setFullYear(y, m - 1, d);
    }
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const localDate = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId: tenant.id,
        createdAt: { gte: from, lt: to },
        ...(params.status ? { status: params.status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true, phone: true } },
        items: true,
        dispatches: {
          include: { posterAccount: { select: { name: true, sortOrder: true } } },
          orderBy: { posterAccount: { sortOrder: 'asc' } },
        },
      },
    });

    return {
      date: localDate,
      total: orders.length,
      revenue: orders
        .filter((o) => o.status !== 'CANCELLED')
        .reduce((s, o) => s + o.total, 0),
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        createdAt: o.createdAt,
        scheduledAt: o.scheduledAt,
        type: o.type,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        customer: o.customer,
        address: o.address,
        comment: o.comment,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        discount: o.discount,
        total: o.total,
        items: o.items.map((i) => ({
          name: i.name,
          qty: i.qty,
          price: i.price,
          isGift: i.isGift,
          modifiers: i.modifiers,
        })),
        parts: o.dispatches.map((d) => ({
          department: d.posterAccount.name,
          status: d.status,
          posterStatus: d.posterStatus,
          posterOrderId: d.posterOrderId,
          error: d.error,
        })),
      })),
    };
  }

  /** Дашборд: показатели дня + сравнение со вчера */
  async dashboard(dateStr?: string) {
    const tenant = await this.tenant();
    const from = new Date();
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      from.setFullYear(y, m - 1, d);
    }
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - 1);

    const [today, yesterday] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: from, lt: to } },
        include: { items: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: prevFrom, lt: from } },
        select: { total: true, status: true },
      }),
    ]);

    const paid = today.filter((o) => o.status !== 'CANCELLED');
    const revenue = paid.reduce((s, o) => s + o.total, 0);
    const prevPaid = yesterday.filter((o) => o.status !== 'CANCELLED');

    // выручка по часам
    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      orders: 0,
      revenue: 0,
    }));
    for (const o of paid) {
      const h = new Date(o.createdAt).getHours();
      byHour[h].orders++;
      byHour[h].revenue += o.total;
    }

    // топ товаров
    const productStats = new Map<string, { name: string; qty: number; sum: number }>();
    for (const o of paid) {
      for (const i of o.items) {
        const cur = productStats.get(i.name) ?? { name: i.name, qty: 0, sum: 0 };
        cur.qty += i.qty;
        cur.sum += i.isGift ? 0 : i.price * i.qty;
        productStats.set(i.name, cur);
      }
    }

    return {
      date: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`,
      orders: paid.length,
      revenue,
      averageCheck: paid.length ? Math.round(revenue / paid.length) : 0,
      cancelled: today.length - paid.length,
      comparison: {
        orders: prevPaid.length,
        revenue: prevPaid.reduce((s, o) => s + o.total, 0),
      },
      byType: {
        delivery: paid.filter((o) => o.type === 'DELIVERY').length,
        pickup: paid.filter((o) => o.type === 'PICKUP').length,
      },
      byPayment: {
        cash: paid.filter((o) => o.paymentMethod === 'CASH').length,
        card: paid.filter((o) => o.paymentMethod === 'CARD_ON_DELIVERY').length,
        online: paid.filter((o) => o.paymentMethod === 'KASPI_ONLINE').length,
      },
      byHour,
      topProducts: [...productStats.values()]
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10),
    };
  }

  /** Клиентская база с поиском и сортировкой */
  async customers(params: { search?: string; page?: number; sort?: string }) {
    const tenant = await this.tenant();
    const take = 50;
    const skip = ((params.page ?? 1) - 1) * take;
    const where = {
      tenantId: tenant.id,
      ...(params.search
        ? {
            OR: [
              { phone: { contains: params.search } },
              { name: { contains: params.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: {
            where: { status: { not: 'CANCELLED' } },
            select: { total: true, createdAt: true },
          },
        },
      }),
    ]);

    return {
      total,
      page: params.page ?? 1,
      pages: Math.ceil(total / take),
      customers: customers.map((c) => {
        const sum = c.orders.reduce((s, o) => s + o.total, 0);
        const last = c.orders.reduce<Date | null>(
          (acc, o) => (!acc || o.createdAt > acc ? o.createdAt : acc),
          null,
        );
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          pointsBalance: c.pointsBalance,
          loyaltyLevel: c.loyaltyLevel,
          ordersCount: c.orders.length,
          totalSpent: sum,
          averageCheck: c.orders.length ? Math.round(sum / c.orders.length) : 0,
          lastOrderAt: last,
          createdAt: c.createdAt,
        };
      }),
    };
  }

  async customerDetails(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { items: { select: { name: true, qty: true, isGift: true } } },
        },
        loyaltyTxns: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!customer) throw new NotFoundException('Клиент не найден');
    return customer;
  }

  async promotions() {
    const tenant = await this.tenant();
    const promos = await this.prisma.promotion.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: 'asc' },
    });
    // подтягиваем читаемые имена условия и подарка
    const catIds = promos.map((p) => p.conditionCategoryId);
    const prodIds = promos.map((p) => p.giftProductId);
    const [cats, prods] = await Promise.all([
      this.prisma.appCategory.findMany({ where: { id: { in: catIds } } }),
      this.prisma.product.findMany({ where: { id: { in: prodIds } } }),
    ]);
    const catById = new Map(cats.map((c) => [c.id, c.name]));
    const prodById = new Map(prods.map((p) => [p.id, p.displayName ?? p.name]));

    return promos.map((p) => ({
      ...p,
      conditionCategoryName: catById.get(p.conditionCategoryId) ?? '—',
      giftProductName: prodById.get(p.giftProductId) ?? '—',
    }));
  }

  async createPromotion(dto: PromotionDto) {
    const tenant = await this.tenant();
    const [category, gift] = await Promise.all([
      this.prisma.appCategory.findFirst({
        where: { id: dto.conditionCategoryId, tenantId: tenant.id },
        select: { id: true },
      }),
      this.prisma.product.findFirst({
        where: { id: dto.giftProductId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);
    if (!category) throw new BadRequestException('Категория акции не найдена');
    if (!gift) throw new BadRequestException('Подарочный товар не найден');
    if (
      dto.activeFrom &&
      dto.activeTo &&
      new Date(dto.activeFrom) >= new Date(dto.activeTo)
    ) {
      throw new BadRequestException('Дата окончания должна быть позже начала');
    }
    return this.prisma.promotion.create({
      data: {
        tenantId: tenant.id,
        name: dto.name.trim(),
        code: dto.code?.trim().toUpperCase() || null,
        conditionCategoryId: dto.conditionCategoryId,
        conditionQty: dto.conditionQty,
        giftProductId: dto.giftProductId,
        giftQty: dto.giftQty ?? 1,
        repeatPerCart: dto.repeatPerCart ?? true,
        isActive: dto.isActive ?? true,
        activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : null,
        activeTo: dto.activeTo ? new Date(dto.activeTo) : null,
      },
    });
  }

  async updatePromotion(id: string, dto: Partial<PromotionDto>) {
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code === '' ? null : dto.code,
        activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : undefined,
        activeTo: dto.activeTo ? new Date(dto.activeTo) : undefined,
      } as any,
    });
  }

  async settings() {
    const tenant = await this.tenant();
    const [venues, accounts] = await Promise.all([
      this.prisma.venue.findMany({ where: { tenantId: tenant.id } }),
      this.prisma.posterAccount.findMany({
        where: { tenantId: tenant.id },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, sortOrder: true, isActive: true },
      }),
    ]);
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      settings: tenant.settings,
      venues,
      posterAccounts: accounts, // без токенов
    };
  }

  async updateSettings(dto: UpdateSettingsDto) {
    const tenant = await this.tenant();
    const current = (tenant.settings as any) ?? {};
    const delivery = { ...(current.delivery ?? {}), ...dto };
    if (
      delivery.freeFrom > 0 &&
      delivery.minOrder > 0 &&
      delivery.freeFrom < delivery.minOrder
    ) {
      throw new BadRequestException(
        'Порог бесплатной доставки не может быть ниже минимального заказа',
      );
    }
    return this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { settings: { ...current, delivery } },
      select: { settings: true },
    });
  }

  async addPosterAccount(dto: PosterAccountDto) {
    const tenant = await this.tenant();
    try {
      await this.poster.getCategories(dto.token.trim());
    } catch {
      throw new BadRequestException('Токен Poster недействителен');
    }
    const acc = await this.prisma.posterAccount.upsert({
      where: {
        tenantId_name: { tenantId: tenant.id, name: dto.name.trim() },
      },
      create: {
        tenantId: tenant.id,
        name: dto.name.trim(),
        token: dto.token.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
      update: {
        token: dto.token.trim(),
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
      },
      select: { id: true, name: true, sortOrder: true, isActive: true },
    });
    return acc;
  }
}
