import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Сколько предложений показываем клиенту за раз */
const MAX_SUGGESTIONS = 6;

/**
 * Допродажи: что предложить добавить к собранному заказу
 * (DECISIONS §12.20).
 *
 * Привязка к витринной категории, а не общий список на всё меню. Соус к
 * пицце уместен, соус к десерту — нет, и одно неуместное предложение
 * обесценивает все остальные: человек перестаёт читать этот блок.
 * Категория `null` означает «к любому заказу» — так живут напитки.
 */
@Injectable()
export class UpsellService {
  constructor(private readonly prisma: PrismaService) {}

  /** Весь список для админки: и наборы по категориям, и общий */
  async list(tenantId: string) {
    const items = await this.prisma.upsellItem.findMany({
      where: { tenantId },
      orderBy: [{ appCategoryId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        appCategoryId: true,
        sortOrder: true,
        isActive: true,
        product: {
          select: {
            id: true,
            name: true,
            displayName: true,
            price: true,
            priceOverride: true,
            photoUrl: true,
            displayPhotoUrl: true,
          },
        },
      },
    });

    return items.map(({ product, ...rest }) => ({
      ...rest,
      productId: product.id,
      name: product.displayName ?? product.name,
      price: product.priceOverride ?? product.price,
      photoUrl: product.displayPhotoUrl ?? product.photoUrl,
    }));
  }

  async add(
    tenantId: string,
    data: { productId: string; appCategoryId?: string | null },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Товар не найден');

    const appCategoryId = data.appCategoryId ?? null;
    if (appCategoryId) {
      const category = await this.prisma.appCategory.findFirst({
        where: { id: appCategoryId, tenantId },
        select: { id: true },
      });
      if (!category) throw new BadRequestException('Категория не найдена');
    }

    const last = await this.prisma.upsellItem.aggregate({
      where: { tenantId, appCategoryId },
      _max: { sortOrder: true },
    });

    // Повторное добавление того же товара в тот же набор — не ошибка, а
    // обычный промах: молча включаем обратно, если он был выключен.
    return this.prisma.upsellItem.upsert({
      where: {
        tenantId_productId_appCategoryId: {
          tenantId,
          productId: data.productId,
          appCategoryId: appCategoryId as string,
        },
      },
      create: {
        tenantId,
        productId: data.productId,
        appCategoryId,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
      update: { isActive: true },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.prisma.upsellItem.deleteMany({ where: { id, tenantId } });
    return { removed: true };
  }

  /**
   * Что предложить к этой корзине.
   *
   * Отбираем по категориям того, что уже лежит в корзине, плюс общий
   * набор. То, что уже в корзине, и то, что сейчас недоступно, не
   * предлагаем: предложить купить лежащее в корзине — верный способ
   * научить человека не смотреть на этот блок.
   */
  async suggest(tenantId: string, cartProductIds: string[], now = new Date()) {
    if (cartProductIds.length === 0) return [];

    const inCart = await this.prisma.product.findMany({
      where: { id: { in: cartProductIds }, tenantId },
      select: { id: true, appCategoryId: true },
    });
    const categories = [
      ...new Set(
        inCart
          .map((p) => p.appCategoryId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const items = await this.prisma.upsellItem.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ appCategoryId: null }, { appCategoryId: { in: categories } }],
        product: {
          id: { notIn: cartProductIds },
          isActive: true,
          isVisible: true,
        },
      },
      orderBy: [{ appCategoryId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        appCategoryId: true,
        product: {
          select: {
            id: true,
            name: true,
            displayName: true,
            displayNameKk: true,
            price: true,
            priceOverride: true,
            photoUrl: true,
            displayPhotoUrl: true,
            weightLabel: true,
            weightLabelKk: true,
            stoppedUntil: true,
            appCategory: { select: { stoppedUntil: true } },
            // Позиции с выбором добавляются не одним нажатием, а через
            // карточку — в блоке допродаж им не место
            modifiers: true,
            comboGroups: { select: { id: true }, take: 1 },
          },
        },
      },
    });

    const seen = new Set<string>();
    const result: {
      productId: string;
      name: string;
      nameKk: string | null;
      price: number;
      photoUrl: string | null;
      weightLabel: string | null;
      weightLabelKk: string | null;
    }[] = [];

    for (const { product } of items) {
      if (seen.has(product.id)) continue;
      // Срок стопа сравниваем здесь, как и в меню: позиция возвращается
      // сама, даже если фоновая задача не отработала.
      const stopped =
        (product.stoppedUntil && product.stoppedUntil > now) ||
        (product.appCategory?.stoppedUntil &&
          product.appCategory.stoppedUntil > now);
      if (stopped) continue;

      // Допродажа должна добавляться одним нажатием. Позиция с
      // обязательным выбором потребовала бы карточки, а карточка уводит
      // из корзины — ровно оттуда, куда человек уже дошёл.
      const needsChoice =
        (Array.isArray(product.modifiers) && product.modifiers.length > 0) ||
        product.comboGroups.length > 0;
      if (needsChoice) continue;

      seen.add(product.id);
      result.push({
        productId: product.id,
        name: product.displayName ?? product.name,
        nameKk: product.displayNameKk,
        price: product.priceOverride ?? product.price,
        photoUrl: product.displayPhotoUrl ?? product.photoUrl,
        weightLabel: product.weightLabel,
        weightLabelKk: product.weightLabelKk,
      });
      if (result.length >= MAX_SUGGESTIONS) break;
    }

    return result;
  }
}
