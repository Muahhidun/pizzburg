import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { TelegramGatewayService } from './telegram-gateway.service';

/// Глобальный: код при входе сегодня, уведомления о заказе — возможно, завтра.
@Global()
@Module({
  providers: [SmsService, TelegramGatewayService],
  exports: [SmsService, TelegramGatewayService],
})
export class SmsModule {}
