import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { PosterModule } from '../poster/poster.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PosterModule, StorageModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
