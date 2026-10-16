import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn } from "class-validator";
import { CustomerAuthGuard } from "../auth/customer-auth.guard";
import { OrderOwnerGuard } from "../auth/order-owner.guard";
import { PaymentsService } from "./payments.service";

class CreatePaymentDto {
  @IsIn(["MOBILE_LINK", "WEB_QR"])
  channel: "MOBILE_LINK" | "WEB_QR";
}

/**
 * Клиентские маршруты оплаты.
 *
 * Доступны только владельцу заказа. Сам способ оплаты при этом остаётся
 * скрытым, пока `payments.kaspiOnline` не включён в настройках заведения:
 * создать заказ KASPI_ONLINE раньше этого не позволит AvailabilityService.
 */
@Controller("payments/orders/:orderId")
@UseGuards(CustomerAuthGuard, OrderOwnerGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  create(@Param("orderId") orderId: string, @Body() dto: CreatePaymentDto) {
    return this.payments.createKaspiPayment(orderId, dto.channel);
  }

  /**
   * Сервер сам обращается к Kaspi: сертификат и DeviceToken никогда не
   * попадают в мобильное приложение. Клиент получает только безопасное
   * состояние своей попытки оплаты.
   */
  @Get()
  sync(@Param("orderId") orderId: string) {
    return this.payments.syncOrderPayment(orderId);
  }
}
