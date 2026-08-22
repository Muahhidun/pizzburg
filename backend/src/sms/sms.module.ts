import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';

/// Глобальный: код при входе сегодня, уведомления о заказе — возможно, завтра.
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
