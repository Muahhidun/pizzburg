import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

/** Возвраты не теряются при рестарте: срок следующей попытки лежит в БД. */
@Injectable()
export class RefundRetryService {
  private readonly logger = new Logger(RefundRetryService.name);

  constructor(private readonly payments: PaymentsService) {}

  @Cron('*/1 * * * *')
  async retryDue() {
    const count = await this.payments.retryDueRefunds();
    if (count > 0) this.logger.log(`Повторено возвратов Kaspi: ${count}`);
  }
}
