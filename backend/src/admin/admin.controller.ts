import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { MessagesService } from '../messages/messages.service';
import { RushService } from '../availability/rush.service';
import { UpsellService } from '../upsell/upsell.service';
import {
  PosterAccountDto,
  PromotionDto,
  ReorderDto,
  UpdateCategoryDto,
  UpdateProductDto,
  CreateAddressDto,
  CreateMessageDto,
  UpdateMessageDto,
  UpdateAddressDto,
  UpdateCancellationDto,
  UpdateRushDto,
  AddUpsellDto,
  UpdateLoyaltyLevelsDto,
  UpdateOrderingDto,
  UpdatePaymentsDto,
  UpdatePreorderDto,
  UpdateScheduleDto,
  UpdateSettingsDto,
  UpdateOrderStatusDto,
  MarkShortageDto,
  StopItemDto,
  ReleaseStopDto,
  TelegramSettingsDto,
  AdjustLoyaltyDto,
  PublishLegalDto,
  CancelReasonDto,
  CancelOrderByAdminDto,
  UpdateCancelReasonDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly messages: MessagesService,
    private readonly rush: RushService,
    private readonly upsell: UpsellService,
  ) {}

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

  /**
   * Консоль кассира: заказы, по которым ещё есть что решать.
   *
   * Отдельно от ленты за день: кассир заходит сюда только когда чего-то
   * нет, и ей нужен короткий список живых заказов с составом, а не отчёт.
   */
  @Get('orders/queue')
  orderQueue() {
    return this.admin.orderQueue();
  }

  /** «Этой позиции нет»: пустой список снимает пометку (DECISIONS §12.9) */
  @Post('orders/:id/shortage')
  markShortage(@Param('id') id: string, @Body() dto: MarkShortageDto) {
    return this.admin.markShortage(id, dto.itemIds);
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

  // ─── Стоп-листы со сроком (DECISIONS §12.3) ──────────────────

  /** Что сейчас на стопе + доступные сроки */
  @Get('stoplist')
  stopList() {
    return this.admin.stopList();
  }

  /** Поставить позицию или категорию на стоп. Срок обязателен */
  @Post('stoplist')
  stopItem(@Body() dto: StopItemDto) {
    return this.admin.stopItem(dto);
  }

  /** Досрочно вернуть в продажу */
  @Post('stoplist/release')
  releaseStop(@Body() dto: ReleaseStopDto) {
    return this.admin.releaseStop(dto);
  }

  /** Ручной синк меню с Poster — не ждать четверть часа */
  @Post('poster-sync')
  syncPoster() {
    return this.admin.syncPoster();
  }

  // ─── Телеграм-канал руководства (DECISIONS §12.7) ────────────

  @Get('settings/telegram')
  telegramSettings() {
    return this.admin.telegramSettings();
  }

  @Patch('settings/telegram')
  updateTelegram(@Body() dto: TelegramSettingsDto) {
    return this.admin.updateTelegram(dto);
  }

  /** Определить чат по последнему сообщению боту */
  @Post('settings/telegram/detect-chat')
  telegramDetectChat() {
    return this.admin.telegramDetectChat();
  }

  @Post('settings/telegram/test')
  telegramTest(@Query('target') target?: string) {
    return this.admin.telegramTest(target === 'cashier' ? 'CASHIER' : 'OWNER');
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

  // ─── Лента сообщений ─────────────────────────────────────────

  @Get('messages')
  listMessages() {
    return this.messages.list();
  }

  /** Создаёт сообщение; с sendPush — сразу рассылает всем устройствам */
  @Post('messages')
  createMessage(@Body() dto: CreateMessageDto) {
    return this.messages.create(dto);
  }

  @Patch('messages/:id')
  updateMessage(@Param('id') id: string, @Body() dto: UpdateMessageDto) {
    return this.messages.setPublished(id, dto.isPublished);
  }

  // ─── Адресный справочник города ──────────────────────────────

  @Get('addresses')
  addresses(
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    return this.admin.addresses(q ?? '', Number(page) || 1);
  }

  @Post('addresses')
  createAddress(@Body() dto: CreateAddressDto) {
    return this.admin.createAddress(dto);
  }

  @Patch('addresses/:id')
  updateAddress(@Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.admin.updateAddress(id, dto);
  }

  /** Заявки «моего адреса нет в списке» */
  @Get('address-requests')
  addressRequests(@Query('resolved') resolved?: string) {
    return this.admin.addressRequests(resolved === '1');
  }

  @Post('address-requests/:id/resolve')
  resolveAddressRequest(@Param('id') id: string) {
    return this.admin.resolveAddressRequest(id);
  }

  /** Лестница кэшбэка: 3% новичку … 6% постоянному */
  @Get('settings/loyalty-levels')
  loyaltyLevels() {
    return this.admin.loyaltyLevels();
  }

  @Put('settings/loyalty-levels')
  updateLoyaltyLevels(@Body() dto: UpdateLoyaltyLevelsDto) {
    return this.admin.updateLoyaltyLevels(dto);
  }

  /**
   * Сырая техкарта из Poster — чтобы увидеть, что там вообще есть.
   *
   * Диагностический маршрут: структура ответа у Poster отличается для
   * товара, блюда и техкарты, а документация рисуется скриптом и не
   * читается. Проще посмотреть на живом ответе, чем гадать.
   */
  @Get('poster/product/:id')
  posterProduct(@Param('id') id: string) {
    return this.admin.posterProductRaw(id);
  }

  // ─── Допродажи ───────────────────────────────────────────────

  @Get('upsells')
  listUpsells() {
    return this.admin.listUpsells();
  }

  @Post('upsells')
  addUpsell(@Body() dto: AddUpsellDto) {
    return this.admin.addUpsell(dto);
  }

  @Delete('upsells/:id')
  removeUpsell(@Param('id') id: string) {
    return this.admin.removeUpsell(id);
  }

  @Patch('settings/rush')
  updateRush(@Body() dto: UpdateRushDto) {
    return this.rush.set(dto.extraMinutes);
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

  @Get('reports/promotions')
  promotionReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.promotionReport(from, to);
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
