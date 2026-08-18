import { Module } from '@nestjs/common';
import { StopListService } from './stoplist.service';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [AvailabilityModule],
  providers: [StopListService],
  exports: [StopListService],
})
export class StopListModule {}
