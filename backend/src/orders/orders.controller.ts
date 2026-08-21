import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './orders.dto';
import { CancelReasonsService } from './cancel-reasons.service';
import { ShortageService } from './shortage.service';
import {
  MESSAGE_TOPICS,
  OrderMessagesService,
} from './order-messages.service';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';

/** Ответы анкеты: ключ вопроса — выбранный вариант */
class ReviewDto {
  @IsObject()
  answers: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  text?: string;
}

/** Обращение по живому заказу (DECISIONS §12.21) */
class OrderMessageDto {
  @IsIn(Object.keys(MESSAGE_TOPICS))
  topic: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}

class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  /** Причина из справочника: без неё отчёт по отменам не построить */
  @IsOptional()
  @IsString()
  reasonId?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly reasons: CancelReasonsService,
    private readonly shortage: ShortageService,
    private readonly prisma: PrismaService,
    private readonly messages: OrderMessagesService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * Оформление заказа. Только для вошедших (DECISIONS §12.22).
   *
   * Гостевой заказ убран сознательно: подтверждённый по SMS номер — это
   * защита от ложных заказов. Без неё любой может отправить на кухню
   * чужой адрес, и узнаем мы об этом, когда курьер уже уехал.
   */
  @Post(':tenantSlug')
  @UseGuards(CustomerAuthGuard)
  create(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreateOrderDto,
    @Req() req: any,
  ) {
    return this.orders.createOrder(tenantSlug, dto, req.customer);
  }

  @Get('by-id/:orderId')
  get(@Param('orderId') orderId: string) {
    return this.orders.getOrder(orderId);
  }

  @Post('by-id/:orderId/sync-status')
  syncStatus(@Param('orderId') orderId: string) {
    return this.orders.syncStatus(orderId);
  }

  /**
   * Написать нам по живому заказу.
   *
   * Без входа: заказ можно оформить гостем, и именно гость чаще всего
   * пишет «не тот адрес». Требовать вход там, где человек уже ждёт еду,
   * значит закрыть единственный канал связи ровно тогда, когда он нужен.
   * От спама защищает не вход, а лимит в самом сервисе.
   */
  @Post('by-id/:orderId/message')
  sendMessage(
    @Param('orderId') orderId: string,
    @Body() dto: OrderMessageDto,
  ) {
    return this.messages.send(orderId, dto);
  }

  /**
   * Анкета о заказе (DECISIONS §12.23).
   *
   * Вопросы отдаёт сервер, а не хранит приложение: формулировки будут
   * меняться, и менять их через релиз в App Store — значит не менять
   * никогда. Заодно у самовывоза не спрашивают про курьера.
   */
  /** Заказ, по которому ждём отзыв: блок на главной */
  @Get(':tenantSlug/pending-review')
  @UseGuards(CustomerAuthGuard)
  pendingReview(@Req() req: any) {
    return this.reviews.pending(req.customer.sub);
  }

  @Get('by-id/:orderId/review')
  reviewForm(@Param('orderId') orderId: string) {
    return this.reviews.form(orderId);
  }

  @Post('by-id/:orderId/review')
  submitReview(@Param('orderId') orderId: string, @Body() dto: ReviewDto) {
    return this.reviews.submit(orderId, dto);
  }

  /** Отмена клиентом в окно, заданное арендатором */
  @Post('by-id/:orderId/cancel')
  @UseGuards(CustomerAuthGuard)
  cancel(
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
    @Req() req: any,
  ) {
    return this.orders.cancelByCustomer(
      orderId,
      req.customer.sub,
      dto.reason,
      dto.reasonId,
    );
  }

  /**
   * Ответ клиента на нехватку позиции (DECISIONS §12.9).
   *
   * Два эндпоинта, а не один с параметром: выбор необратимый, и «везти
   * без неё» не должно превратиться в «отменить» из-за опечатки в теле
   * запроса.
   */
  @Post('by-id/:orderId/shortage/keep')
  @UseGuards(CustomerAuthGuard)
  keepRest(@Param('orderId') orderId: string, @Req() req: any) {
    return this.shortage.respond(orderId, req.customer.sub, 'KEEP');
  }

  @Post('by-id/:orderId/shortage/cancel')
  @UseGuards(CustomerAuthGuard)
  cancelForShortage(@Param('orderId') orderId: string, @Req() req: any) {
    return this.shortage.respond(orderId, req.customer.sub, 'CANCEL');
  }

  /** Последний заказ для блока «Тот же заказ?» на главном экране */
  @Get(':tenantSlug/last')
  @UseGuards(CustomerAuthGuard)
  async lastOrder(@Param('tenantSlug') tenantSlug: string, @Req() req: any) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    return this.orders.lastOrder(tenant.id, req.customer.sub);
  }

  /** Собрать корзину из прошлого заказа по текущему меню и ценам */
  @Post('by-id/:orderId/repeat')
  @UseGuards(CustomerAuthGuard)
  async repeat(@Param('orderId') orderId: string, @Req() req: any) {
    return this.orders.repeatOrder(
      orderId,
      req.customer.tenantId,
      req.customer.sub,
    );
  }

  /** Причины отмены, доступные клиенту */
  @Get(':tenantSlug/cancel-reasons')
  async cancelReasons(@Param('tenantSlug') tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    const reasons = await this.reasons.list(tenant.id, true);
    return reasons.map((r) => ({ id: r.id, label: r.label }));
  }
}
