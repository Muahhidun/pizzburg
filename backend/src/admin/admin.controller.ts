import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  PosterAccountDto,
  PromotionDto,
  ReorderDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateSettingsDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('storefront')
  storefront(@Query('tenant') tenant?: string) {
    return this.admin.storefront(tenant);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.admin.updateCategory(id, dto);
  }

  @Post('categories/reorder')
  reorderCategories(@Body() dto: ReorderDto) {
    return this.admin.reorderCategories(dto.ids);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.admin.updateProduct(id, dto);
  }

  @Post('products/reorder')
  reorderProducts(@Body() dto: ReorderDto) {
    return this.admin.reorderProducts(dto.ids);
  }

  @Get('dashboard')
  dashboard(@Query('date') date?: string) {
    return this.admin.dashboard(date);
  }

  @Get('customers')
  customers(
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.admin.customers({ search, page: page ? Number(page) : 1 });
  }

  @Get('customers/:id')
  customerDetails(@Param('id') id: string) {
    return this.admin.customerDetails(id);
  }

  @Get('orders')
  orders(@Query('date') date?: string, @Query('status') status?: string) {
    return this.admin.orders({ date, status });
  }

  @Get('promotions')
  promotions() {
    return this.admin.promotions();
  }

  @Post('promotions')
  createPromotion(@Body() dto: PromotionDto) {
    return this.admin.createPromotion(dto);
  }

  @Patch('promotions/:id')
  updatePromotion(@Param('id') id: string, @Body() dto: Partial<PromotionDto>) {
    return this.admin.updatePromotion(id, dto);
  }

  @Get('settings')
  settings() {
    return this.admin.settings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.admin.updateSettings(dto);
  }

  @Post('poster-accounts')
  addPosterAccount(@Body() dto: PosterAccountDto) {
    return this.admin.addPosterAccount(dto);
  }
}
