import { Module } from '@nestjs/common';
import { StopListModule } from '../stoplist/stoplist.module';
import { CashierPanelService } from './cashier-panel.service';

/** Пульт кассы в группе кассиров Телеграма */
@Module({
  imports: [StopListModule],
  providers: [CashierPanelService],
})
export class CashierPanelModule {}
