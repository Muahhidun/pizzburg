import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from './poster.client';
import { WdrinkClient } from '../wdrink/wdrink.client';
import { isWdrink } from '../wdrink/wdrink-dispatch';

/**
 * Синхронизация меню Poster → БД. Poster — источник правды:
 * категории, товары, цены, фото, скрытость (стоп-лист).
 * У тенанта может быть несколько аккаунтов Poster (отделов) —
 * каждый синхронизируется отдельно, меню сливается на выдаче.
 */
@Injectable()
export class PosterSyncService {
  private readonly logger = new Logger(PosterSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
    private readonly wdrink?: WdrinkClient,
  ) {}

  /** Каждые 15 минут синхронизируем все активные аккаунты */
  @Cron('*/15 * * * *')
  async syncAll() {
    const accounts = await this.prisma.posterAccount.findMany({
      where: { isActive: true },
    });
    for (const acc of accounts) {
      try {
        await this.syncAccount(acc.id);
      } catch (e) {
        this.logger.error(`Sync failed for account ${acc.name}: ${e}`);
      }
    }
  }

  /** Синк всех отделов тенанта (ручной запуск из админки) */
  async syncTenant(tenantId: string) {
    const accounts = await this.prisma.posterAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (accounts.length === 0) {
      throw new NotFoundException('Tenant has no active Poster accounts');
    }
    const results: Record<string, { categories: number; products: number }> = {};
    for (const acc of accounts) {
      results[acc.name] = await this.syncAccount(acc.id);
    }
    return results;
  }

  async syncAccount(accountId: string) {
    const account = await this.prisma.posterAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Poster account not found');
    if (isWdrink(account)) return this.syncWdrink(account);
    const { token, tenantId } = account;

    const [categories, products] = await Promise.all([
      this.poster.getCategories(token),
      this.poster.getProducts(token),
    ]);

    // Категории кассы. Каждой нужна витринная категория (AppCategory):
    // ищем по имени (одноимённые категории двух отделов сливаются в одну
    // витринную), иначе создаём новую в конце списка.
    const categoryIdByPosterId = new Map<string, string>();
    const appCategoryIdByCategoryId = new Map<string, string>();
    for (const c of categories) {
      let row = await this.prisma.category.upsert({
        where: {
          posterAccountId_posterId: {
            posterAccountId: account.id,
            posterId: c.category_id,
          },
        },
        create: {
          tenantId,
          posterAccountId: account.id,
          posterId: c.category_id,
          name: c.category_name,
          sortOrder: Number(c.sort_order ?? 0),
          isActive: c.category_hidden !== '1',
        },
        update: {
          name: c.category_name,
          sortOrder: Number(c.sort_order ?? 0),
          isActive: c.category_hidden !== '1',
        },
      });

      if (!row.appCategoryId) {
        let app = await this.prisma.appCategory.findFirst({
          where: { tenantId, name: c.category_name },
        });
        if (!app) {
          const last = await this.prisma.appCategory.aggregate({
            where: { tenantId },
            _max: { sortOrder: true },
          });
          app = await this.prisma.appCategory.create({
            data: {
              tenantId,
              name: c.category_name,
              sortOrder: (last._max.sortOrder ?? 0) + 1,
            },
          });
        }
        row = await this.prisma.category.update({
          where: { id: row.id },
          data: { appCategoryId: app.id },
        });
      }
      categoryIdByPosterId.set(c.category_id, row.id);
      appCategoryIdByCategoryId.set(row.id, row.appCategoryId!);
    }

    // Товары
    let synced = 0;
    for (const p of products) {
      const categoryId = categoryIdByPosterId.get(p.menu_category_id);
      if (!categoryId) continue; // товар вне известных категорий

      const firstSpot = p.spots?.[0];
      const rawPrice = firstSpot?.price ?? Object.values(p.price ?? {})[0];
      const hidden =
        p.hidden === '1' || (firstSpot ? firstSpot.visible === '0' : false);

      // Витринные поля (appCategoryId, displayName, isVisible, sortOverride)
      // задаются только при создании — дальше ими управляет владелец.
      const data = {
        categoryId,
        name: p.product_name.trim(), // Poster иногда отдаёт имена с хвостовыми пробелами
        description: p.product_production_description ?? '',
        photoUrl: PosterClient.photoUrl(p.photo_origin ?? p.photo),
        price: PosterClient.toTenge(rawPrice),
        isActive: !hidden,
        sortOrder: Number(p.sort_order ?? 0),
        modifiers: (p.group_modifications ?? []) as object[],
      };
      await this.prisma.product.upsert({
        where: {
          posterAccountId_posterId: {
            posterAccountId: account.id,
            posterId: p.product_id,
          },
        },
        create: {
          tenantId,
          posterAccountId: account.id,
          posterId: p.product_id,
          appCategoryId: appCategoryIdByCategoryId.get(categoryId) ?? null,
          ...data,
        },
        update: data,
      });
      synced++;
    }

    // Позиции, исчезнувшие из Poster (удалены с кассы), деактивируем:
    // из приложения пропадут, но останутся в БД для истории заказов.
    const seenCategoryIds = categories.map((c) => c.category_id);
    const seenProductIds = products.map((p) => p.product_id);
    await this.prisma.product.updateMany({
      where: { posterAccountId: account.id, posterId: { notIn: seenProductIds } },
      data: { isActive: false },
    });
    await this.prisma.category.updateMany({
      where: { posterAccountId: account.id, posterId: { notIn: seenCategoryIds } },
      data: { isActive: false },
    });

    this.logger.log(
      `Synced account ${account.name}: ${categories.length} categories, ${synced} products`,
    );
    return { categories: categories.length, products: synced };
  }

  /** Витринная категория по имени — та же, что для Poster: одноимённые сливаются */
  private async appCategoryFor(tenantId: string, name: string) {
    let app = await this.prisma.appCategory.findFirst({ where: { tenantId, name } });
    if (!app) {
      const last = await this.prisma.appCategory.aggregate({
        where: { tenantId },
        _max: { sortOrder: true },
      });
      app = await this.prisma.appCategory.create({
        data: { tenantId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
    }
    return app.id;
  }

  /**
   * Меню кассы WDrink (DECISIONS §15): только напитки, которые точка
   * отметила «в доставке». Устроено как синк Poster: кассовые поля
   * обновляются, витринные (имя, фото, описание, категория, порядок) —
   * наши и не трогаются. Фото и описаний у WDrink нет, поэтому эти поля
   * не перезаписываются вовсе: перенесённые из Sunday напитки сохраняют
   * свои фото.
   */
  private async syncWdrink(account: {
    id: string;
    name: string;
    tenantId: string;
    token: string;
    apiUrl: string | null;
  }) {
    if (!this.wdrink) throw new Error('Клиент WDrink не подключён');
    const { tenantId } = account;
    const menu = await this.wdrink.getMenu(account);

    const categoryIdByWdrinkId = new Map<string, string>();
    const appCategoryIdByCategoryId = new Map<string, string>();
    for (const c of menu.categories) {
      let row = await this.prisma.category.upsert({
        where: { posterAccountId_posterId: { posterAccountId: account.id, posterId: c.id } },
        create: {
          tenantId,
          posterAccountId: account.id,
          posterId: c.id,
          name: c.name,
          sortOrder: c.sort,
          isActive: true,
        },
        update: { name: c.name, sortOrder: c.sort, isActive: true },
      });
      if (!row.appCategoryId) {
        row = await this.prisma.category.update({
          where: { id: row.id },
          data: { appCategoryId: await this.appCategoryFor(tenantId, c.name) },
        });
      }
      categoryIdByWdrinkId.set(c.id, row.id);
      appCategoryIdByCategoryId.set(row.id, row.appCategoryId!);
    }

    let synced = 0;
    for (const item of menu.items) {
      const categoryId = categoryIdByWdrinkId.get(item.category_id);
      if (!categoryId) continue;
      const data = {
        categoryId,
        name: item.name.trim(),
        price: Math.round(item.price),
        isActive: item.available,
        sortOrder: item.sort,
      };
      await this.prisma.product.upsert({
        where: { posterAccountId_posterId: { posterAccountId: account.id, posterId: item.id } },
        create: {
          tenantId,
          posterAccountId: account.id,
          posterId: item.id,
          appCategoryId: appCategoryIdByCategoryId.get(categoryId) ?? null,
          // Новый напиток появляется скрытым: напитки, перенесённые из
          // Sunday, уже есть в приложении, и дубль клиенту показывать нельзя.
          // Новинку владелец включает в витрине сам.
          isVisible: false,
          ...data,
        },
        update: data,
      });
      synced++;
    }

    // Снятое с доставки или удалённое на кассе пропадает из приложения,
    // но остаётся в базе для истории заказов
    await this.prisma.product.updateMany({
      where: {
        posterAccountId: account.id,
        posterId: { notIn: menu.items.map((i) => i.id) },
      },
      data: { isActive: false },
    });
    await this.prisma.category.updateMany({
      where: {
        posterAccountId: account.id,
        posterId: { notIn: menu.categories.map((c) => c.id) },
      },
      data: { isActive: false },
    });

    this.logger.log(
      `Synced WDrink ${account.name}: ${menu.categories.length} categories, ${synced} products`,
    );
    return { categories: menu.categories.length, products: synced };
  }
}
