import { Controller, Get, Param } from '@nestjs/common';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get(':tenantSlug')
  getMenu(@Param('tenantSlug') tenantSlug: string) {
    return this.menu.getMenu(tenantSlug);
  }
}
