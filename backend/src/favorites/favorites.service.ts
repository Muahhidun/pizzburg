import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Избранные товары клиента.
 *
 * Возвращаем полноценные карточки товара, а не список id: экран избранного
 * должен показывать актуальные цену и стоп-лист, а не то, что было на
 * момент добавления.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** id избранных товаров — для сердечек в каталоге */
  async ids(customerId: string): Promise<string[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { customerId },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  async list(customerId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: { category: { select: { isActive: true } } },
        },
      },
    });

    return rows
      // Товар могли снять с витрины — в избранном ему делать нечего
      .filter((row) => row.product.isVisible)
      .map((row) => ({
        id: row.product.id,
        name: row.product.displayName ?? row.product.name,
        description:
          row.product.displayDescription ?? row.product.description,
        photoUrl: row.product.displayPhotoUrl ?? row.product.photoUrl,
        weightLabel: row.product.weightLabel ?? '',
        price: row.product.priceOverride ?? row.product.price,
        inStopList: !row.product.isActive || !row.product.category.isActive,
        addedAt: row.createdAt,
      }));
  }

  /// Переключатель, а не отдельные add/remove: сердечко — одна кнопка,
  /// и клиенту не нужно знать текущее состояние, чтобы её нажать.
  async toggle(tenantId: string, customerId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const existing = await this.prisma.favorite.findUnique({
      where: { customerId_productId: { customerId, productId } },
    });

    if (existing) {
      await this.prisma.favorite.delete({ where: { id: existing.id } });
      return { favorite: false };
    }

    await this.prisma.favorite.create({
      data: { tenantId, customerId, productId },
    });
    return { favorite: true };
  }
}
