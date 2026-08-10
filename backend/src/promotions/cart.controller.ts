import { Body, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from './promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';

class CartPreviewItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;
}

class CartPreviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartPreviewItemDto)
  items: CartPreviewItemDto[];

  @IsOptional()
  @IsString()
  promoCode?: string;
}

/**
 * Превью корзины: приложение дёргает при каждом изменении — здесь
 * появляются подарки по акциям («в корзине появилась Маргарита
 * бесплатно») и итоговые суммы. Тот же движок используется при
 * оформлении заказа — расчёт всегда совпадает.
 */
@Controller('cart')
export class CartController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Post(':tenantSlug/preview')
  async preview(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CartPreviewDto,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.productId) }, tenantId: tenant.id },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const lines = dto.items.map((i) => {
      const p = byId.get(i.productId);
      if (!p) throw new NotFoundException(`Товар не найден: ${i.productId}`);
      const price = p.priceOverride ?? p.price;
      subtotal += price * i.qty;
      return {
        productId: p.id,
        name: p.displayName ?? p.name,
        price,
        qty: i.qty,
        inStopList: !p.isActive,
      };
    });

    const promo = await this.promotions.evaluate(
      tenant.id,
      dto.items,
      dto.promoCode,
    );

    const settings = (tenant.settings as any)?.delivery ?? {};
    const loyaltyPolicy = this.loyalty.policy(tenant.settings);
    return {
      items: lines,
      gifts: promo.gifts.map((g) => ({
        productId: g.productId,
        name: g.name,
        qty: g.qty,
        price: 0, // для клиента подарок бесплатный
        fullPrice: g.price,
        promotion: g.promotionName,
      })),
      appliedPromotions: promo.applied,
      subtotal,
      // клиент платит subtotal; скидка — справочно (уйдёт «Личной интеграцией»)
      promoDiscount: promo.discount,
      loyalty: {
        ...loyaltyPolicy,
      },
      delivery: {
        minOrder: settings.minOrder ?? 0,
        fee: subtotal >= (settings.freeFrom ?? Infinity) ? 0 : (settings.fee ?? 0),
        freeFrom: settings.freeFrom ?? null,
        available: subtotal >= (settings.minOrder ?? 0),
      },
    };
  }
}
