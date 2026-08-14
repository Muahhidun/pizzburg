import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  PosterAccountDto,
  PromotionDto,
  ReorderDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateCancellationDto,
  UpdateOrderingDto,
  UpdatePaymentsDto,
  UpdatePreorderDto,
  UpdateScheduleDto,
  UpdateSettingsDto,
  UpdateOrderStatusDto,
  AdjustLoyaltyDto,
  PublishLegalDto,
  CancelReasonDto,
  CancelOrderByAdminDto,
  UpdateCancelReasonDto,
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

  @Post('products/:id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  uploadProductPhoto(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Выберите файл изображения');
    return this.admin.uploadProductPhoto(id, file);
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

  @Post('customers/:id/loyalty-adjust')
  adjustCustomerPoints(
    @Param('id') id: string,
    @Body() dto: AdjustLoyaltyDto,
  ) {
    return this.admin.adjustCustomerPoints(id, dto.amount, dto.comment);
  }

  @Get('orders')
  orders(@Query('date') date?: string, @Query('status') status?: string) {
    return this.admin.orders({ date, status });
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.admin.updateOrderStatus(id, dto.status);
  }

  /** Отмена оператором: причина обязательна, иначе отчёт неполон */
  @Patch('orders/:id/cancel')
  cancelOrder(@Param('id') id: string, @Body() dto: CancelOrderByAdminDto) {
    return this.admin.cancelOrder(id, dto.reasonId, dto.comment);
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

  /** Аварийный режим приёма заказов */
  @Patch('settings/ordering')
  updateOrdering(@Body() dto: UpdateOrderingDto) {
    return this.admin.updateOrdering(dto);
  }

  /** Профили расписания (обычное, Рамадан, конец года) */
  @Patch('settings/schedule')
  updateSchedule(@Body() dto: UpdateScheduleDto) {
    return this.admin.updateSchedule(dto);
  }

  @Patch('settings/preorder')
  updatePreorder(@Body() dto: UpdatePreorderDto) {
    return this.admin.updatePreorder(dto);
  }

  @Patch('settings/payments')
  updatePayments(@Body() dto: UpdatePaymentsDto) {
    return this.admin.updatePayments(dto);
  }

  @Patch('settings/cancellation')
  updateCancellation(@Body() dto: UpdateCancellationDto) {
    return this.admin.updateCancellation(dto);
  }

  // ─── Юридические документы ───────────────────────────────────

  @Get('legal')
  legalDocuments() {
    return this.admin.legalDocuments();
  }

  /** Публикация новой редакции; старые версии сохраняются */
  @Post('legal')
  publishLegal(@Body() dto: PublishLegalDto) {
    return this.admin.publishLegal(dto);
  }

  // ─── Причины отмены ──────────────────────────────────────────

  @Get('cancel-reasons')
  cancelReasons() {
    return this.admin.cancelReasons();
  }

  @Post('cancel-reasons')
  createCancelReason(@Body() dto: CancelReasonDto) {
    return this.admin.createCancelReason(dto);
  }

  @Patch('cancel-reasons/:id')
  updateCancelReason(
    @Param('id') id: string,
    @Body() dto: UpdateCancelReasonDto,
  ) {
    return this.admin.updateCancelReason(id, dto);
  }

  @Get('reports/cancellations')
  cancellationReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.cancellationReport(from, to);
  }

  @Post('poster-accounts')
  addPosterAccount(@Body() dto: PosterAccountDto) {
    return this.admin.addPosterAccount(dto);
  }
}
