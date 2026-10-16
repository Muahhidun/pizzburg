import { Module } from '@nestjs/common';
import { WoltDriveProvider } from './wolt-drive.provider';
import { WoltDriveService } from './wolt-drive.service';
import { WoltDriveController } from './wolt-drive.controller';

@Module({
  controllers: [WoltDriveController],
  providers: [WoltDriveProvider, WoltDriveService],
  exports: [WoltDriveService],
})
export class WoltDriveModule {}
