import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddressEntry,
  findExact,
  searchAddresses,
  searchHouses,
  searchStreets,
} from './address-search';

export interface AddressSuggestion {
  /// Строка для показа в списке: «улица Абая, 38А»
  label: string;
  street: string;
  house: string;
  lat?: number;
  lng?: number;
}

/**
 * Подсказки адресов по собственному справочнику города.
 *
 * Свой справочник, а не внешний сервис: оформление заказа — самое дорогое
 * место в приложении, и оно не должно падать вместе с чужим API, кончившейся
 * квотой или истёкшим ключом. Заодно справочник работает зоной доставки.
 *
 * Весь Экибастуз — около 7 700 адресов, меньше мегабайта в памяти. Поэтому
 * справочник держится в процессе целиком, а не запрашивается из БД на каждую
 * букву: подсказка появляется мгновенно, а логика поиска (склонения,
 * казахские названия) может быть сколь угодно умной, не превращаясь в SQL.
 *
 * Данные — OpenStreetMap (ODbL), импорт `prisma/import-addresses.ts`.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  private cache: AddressEntry[] | null = null;
  private cacheTenant: string | null = null;
  private loading: Promise<AddressEntry[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Сбрасывается после импорта и правок в админке */
  invalidate() {
    this.cache = null;
    this.cacheTenant = null;
  }

  private async book(tenantSlug = 'pizzburg'): Promise<AddressEntry[]> {
    if (this.cache && this.cacheTenant === tenantSlug) return this.cache;
    // Параллельные запросы на старте не должны читать таблицу по разу
    // каждый: первый читает, остальные ждут его.
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true },
      });
      if (!tenant) return [];
      const rows = await this.prisma.address.findMany({
        where: { tenantId: tenant.id, isDeliverable: true },
        select: { street: true, house: true, lat: true, lng: true },
      });
      this.cache = rows;
      this.cacheTenant = tenantSlug;
      this.logger.log(`Справочник адресов загружен: ${rows.length}`);
      return rows;
    })().finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  /** Справочник заполнен — иначе приложение оставит ручной ввод */
  async configured(): Promise<boolean> {
    return (await this.book()).length > 0;
  }

  /**
   * Подсказки по одной строке.
   *
   * Пока номер дома не введён, отдаём улицы: на улице Беркимбаева 217
   * домов, и показать из них первые восемь — значит показать ничего.
   * Как только в запросе появилась цифра, отдаём готовые адреса.
   */
  async suggest(query: string): Promise<AddressSuggestion[]> {
    const q = query.trim();
    // Меньше трёх символов — это ещё не запрос, а шум
    if (q.length < 3) return [];
    const entries = await this.book();

    const addresses = searchAddresses(entries, q);
    if (addresses.length > 0) return addresses.map((a) => this.toSuggestion(a));

    return searchStreets(entries, q).map((street) => ({
      label: street,
      street,
      house: '',
    }));
  }

  /** Дома выбранной улицы — второй шаг после выбора улицы */
  async houses(street: string, query = ''): Promise<AddressSuggestion[]> {
    if (!street.trim()) return [];
    const entries = await this.book();
    return searchHouses(entries, street, query).map((a) =>
      this.toSuggestion(a),
    );
  }

  /** Есть ли такой адрес в справочнике */
  async verify(street: string, house: string) {
    const found = findExact(await this.book(), street, house);
    return found
      ? { known: true, street: found.street, house: found.house }
      : { known: false };
  }

  /**
   * «Моего адреса нет в списке».
   *
   * Закрытый справочник рано или поздно не найдёт реальный адрес реального
   * человека: новый дом, переименованная улица. Заявку сохраняем и заказ
   * пропускаем — иначе мы просто теряем клиента и узнаём об этом только по
   * выручке.
   */
  async requestAddress(
    tenantSlug: string,
    raw: string,
    customerId?: string,
    phone?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) return { ok: false };
    await this.prisma.addressRequest.create({
      data: {
        tenantId: tenant.id,
        raw: raw.trim().slice(0, 300),
        customerId: customerId ?? null,
        phone: phone ?? null,
      },
    });
    return { ok: true };
  }

  private toSuggestion(entry: AddressEntry): AddressSuggestion {
    return {
      label: `${entry.street}, ${entry.house}`,
      street: entry.street,
      house: entry.house,
      lat: entry.lat ?? undefined,
      lng: entry.lng ?? undefined,
    };
  }
}
