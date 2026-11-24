import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { CourierAppController } from './courier-app.controller';
import { CourierAppService } from './courier-app.service';
import { CourierAlertsService } from './courier-alerts.service';
import { CourierAuthGuard } from './courier-auth.guard';
import { CourierCashService } from './courier-cash.service';
import { CourierPhotoService } from './courier-photo.service';
import { CourierRegistrationService } from './courier-registration.service';
import { DispatchBoardService } from './dispatch-board.service';
import { DispatchDeviceGuard } from './dispatch-device.guard';
import { DispatchController } from './dispatch.controller';

/**
 * Курьерский модуль (docs/COURIER_SYSTEM_SPEC.md, DECISIONS §14).
 * Telegram и Prisma глобальные, поэтому импортов не нужно.
 */
@Module({
  controllers: [DispatchController, CourierAppController],
  providers: [
    AssignmentService,
    CourierAppService,
    CourierAlertsService,
    CourierAuthGuard,
    CourierCashService,
    CourierPhotoService,
    CourierRegistrationService,
    DispatchBoardService,
    DispatchDeviceGuard,
  ],
  exports: [CourierRegistrationService, DispatchBoardService],
})
export class CouriersModule {}
