import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PosterModule } from '../poster/poster.module';
import { AssignmentService } from './assignment.service';
import { CourierAppController } from './courier-app.controller';
import { CourierAppService } from './courier-app.service';
import { CourierAlertsService } from './courier-alerts.service';
import { CourierAuthGuard } from './courier-auth.guard';
import { CourierCashService } from './courier-cash.service';
import { CourierPhotoService } from './courier-photo.service';
import { CourierReportService } from './courier-report.service';
import { PosterImportService } from './poster-import.service';
import { CourierRegistrationService } from './courier-registration.service';
import { DispatchBoardService } from './dispatch-board.service';
import { DispatchDeviceGuard } from './dispatch-device.guard';
import { DispatchController } from './dispatch.controller';

/**
 * Курьерский модуль (docs/COURIER_SYSTEM_SPEC.md, DECISIONS §14).
 * Telegram и Prisma глобальные, поэтому импортов не нужно.
 */
@Module({
  imports: [PosterModule, NotificationsModule],
  controllers: [DispatchController, CourierAppController],
  providers: [
    AssignmentService,
    CourierAppService,
    CourierAlertsService,
    CourierAuthGuard,
    CourierCashService,
    CourierPhotoService,
    CourierReportService,
    PosterImportService,
    CourierRegistrationService,
    DispatchBoardService,
    DispatchDeviceGuard,
  ],
  exports: [CourierRegistrationService, DispatchBoardService, CourierReportService],
})
export class CouriersModule {}
