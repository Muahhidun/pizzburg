import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { MenuService } from './menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get(':tenantSlug')
  getMenu(@Param('tenantSlug') tenantSlug: string) {
    return this.menu.getMenu(tenantSlug);
  }

  /**
   * Режим приёма заказов: приложение показывает баннер «закрыто» /
   * «только самовывоз» и решает, предлагать ли «как можно быстрее».
   */
  @Get(':tenantSlug/availability')
  async getAvailability(@Param('tenantSlug') tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    return this.availability.getState(tenant.settings);
  }

  /** Слоты предзаказа для выбранного способа получения */
  @Get(':tenantSlug/preorder-slots')
  async getSlots(
    @Param('tenantSlug') tenantSlug: string,
    @Query('type') type?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    const orderType = type === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    return { type: orderType, slots: this.availability.slots(tenant.settings, orderType) };
  }
}
