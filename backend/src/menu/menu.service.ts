import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from '../poster/poster.client';

/** Сырые наборы модификаторов Poster → чистая структура для приложения */
function normalizeModifierGroups(raw: unknown): {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; price: number }[];
}[] {
  if (!Array.isArray(raw)) return [];
  return (raw as any[])
    .filter((g) => !g.is_deleted)
    .map((g) => ({
      id: String(g.dish_modification_group_id),
      name: String(g.name ?? ''),
      min: Number(g.num_min ?? 0),
      max: Number(g.num_max ?? 1),
      options: Array.isArray(g.modifications)
        ? g.modifications.map((m: any) => ({
            id: String(m.dish_modification_id),
            name: String(m.name ?? ''),
            price: PosterClient.toTenge(m.price),
          }))
        : [],
    }))
    .filter((g) => g.options.length > 0);
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Публичное меню для приложения — строится по ВИТРИННЫМ категориям
   * (AppCategory: свой порядок, имена, видимость), товары остаются
   * привязанными к позициям Poster (цены и стоп-листы из кассы).
   */
  async getMenu(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    const now = new Date();
    const categories = await this.prisma.appCategory.findMany({
      where: { tenantId: tenant.id, isVisible: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: {
            isActive: true, // не в стоп-листе кассы
            isVisible: true, // включён на витрине
            category: { isActive: true }, // категория не скрыта в кассе
            posterAccount: { isActive: true },
            // Наш стоп со сроком (DECISIONS §12.3) позицию НЕ убирает:
            // исчезновение прочитывается как «блюда больше нет», и
            // постоянный клиент решит, что его сняли с меню навсегда.
            // Она остаётся в каталоге неактивной, с подписью.
          },
          orderBy: [
            { sortOverride: { sort: 'asc', nulls: 'last' } },
            { sortOrder: 'asc' },
          ],
          select: {
            id: true,
            name: true,
            displayName: true,
            description: true,
            displayDescription: true,
            photoUrl: true,
            displayPhotoUrl: true,
            weightLabel: true,
            isHit: true,
            isSpicy: true,
            isNew: true,
            price: true,
            priceOverride: true,
            modifiers: true,
            stoppedUntil: true,
            comboGroups: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                name: true,
                minSelect: true,
                maxSelect: true,
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true,
                    name: true,
                    priceDelta: true,
                    photoUrl: true,
                    isDefault: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          products: c.products.map(
            ({
              displayName,
              name,
              description,
              displayDescription,
              photoUrl,
              displayPhotoUrl,
              price,
              priceOverride,
              modifiers,
              comboGroups,
              stoppedUntil,
              ...p
            }) => {
              // Стоп категории накрывает все её позиции: «сегодня без
              // роллов» ставится одним действием, а не двадцатью.
              const until =
                c.stoppedUntil && c.stoppedUntil > now
                  ? c.stoppedUntil
                  : stoppedUntil && stoppedUntil > now
                    ? stoppedUntil
                    : null;
              return {
                name: displayName ?? name,
                description: displayDescription ?? description,
                photoUrl: displayPhotoUrl ?? photoUrl,
                price: priceOverride ?? price,
                // наборы модификаторов Poster («Донер Комбо», «Напиток к сету»)
                modifierGroups: normalizeModifierGroups(modifiers),
                // наши собственные группы (расширение поверх Poster)
                comboGroups,
                /// Временно недоступна: срок сравниваем здесь, поэтому
                /// позиция возвращается сама, даже если фоновая задача
                /// не отработала.
                isAvailable: until === null,
                availableFrom: until,
                ...p,
              };
            },
          ),
        })),
    };
  }
}
