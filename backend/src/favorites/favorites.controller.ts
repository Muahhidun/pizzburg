import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(CustomerAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@Req() req: any) {
    return this.favorites.list(req.customer.sub);
  }

  @Get('ids')
  ids(@Req() req: any) {
    return this.favorites.ids(req.customer.sub);
  }

  @Post(':productId/toggle')
  toggle(@Req() req: any, @Param('productId') productId: string) {
    return this.favorites.toggle(
      req.customer.tenantId,
      req.customer.sub,
      productId,
    );
  }
}
