import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AddressInput = {
  street: string;
  house: string;
  flat?: string | null;
  entrance?: string | null;
  floor?: string | null;
  comment?: string | null;
  label?: string | null;
};

/**
 * Справочник адресов клиента.
 *
 * Адреса не заводятся руками: они накапливаются сами при оформлении
 * доставки. Заставлять человека сначала «добавить адрес», а потом выбрать
 * его — лишний шаг, из-за которого повторный заказ становится длиннее
 * первого.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Пустая строка и пробелы — это «не указано», а не значение */
  private clean(value?: string | null): string | null {
    const trimmed = String(value ?? '').trim();
    return trimmed === '' ? null : trimmed;
  }

  async list(customerId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Запомнить адрес заказа.
   *
   * Ключ дубликата — улица + дом + квартира: подъезд и этаж уточняют тот же
   * адрес, а не создают новый. Повторный заказ по known-адресу поднимает его
   * наверх списка через lastUsedAt.
   */
  async remember(tenantId: string, customerId: string, input: AddressInput) {
    const street = this.clean(input.street);
    const house = this.clean(input.house);
    if (!street || !house) return null;

    // Квартира входит в ключ дубликата, поэтому «не указана» — это пустая
    // строка, а не NULL (см. комментарий в схеме).
    const flat = this.clean(input.flat) ?? '';
    return this.prisma.customerAddress.upsert({
      where: {
        customerId_street_house_flat: { customerId, street, house, flat },
      },
      create: {
        tenantId,
        customerId,
        street,
        house,
        flat,
        entrance: this.clean(input.entrance),
        floor: this.clean(input.floor),
        comment: this.clean(input.comment),
        label: this.clean(input.label),
      },
      // Уточнения перезаписываем только если они пришли: пустой подъезд в
      // новом заказе не должен стирать сохранённый.
      update: {
        lastUsedAt: new Date(),
        ...(this.clean(input.entrance)
          ? { entrance: this.clean(input.entrance) }
          : {}),
        ...(this.clean(input.floor) ? { floor: this.clean(input.floor) } : {}),
        ...(this.clean(input.comment)
          ? { comment: this.clean(input.comment) }
          : {}),
      },
    });
  }

  async remove(customerId: string, id: string) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id, customerId },
    });
    if (!address) throw new NotFoundException('Адрес не найден');
    await this.prisma.customerAddress.delete({ where: { id } });
    return { deleted: true };
  }

  async rename(customerId: string, id: string, label: string | null) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id, customerId },
    });
    if (!address) throw new NotFoundException('Адрес не найден');
    return this.prisma.customerAddress.update({
      where: { id },
      data: { label: this.clean(label) },
    });
  }
}
