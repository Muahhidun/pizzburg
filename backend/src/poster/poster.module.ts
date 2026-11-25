import { Module } from '@nestjs/common';
import { PosterClient } from './poster.client';
import { PosterSyncService } from './poster-sync.service';
import { PosterController } from './poster.controller';
import { WdrinkClient } from '../wdrink/wdrink.client';

@Module({
  providers: [PosterClient, PosterSyncService, WdrinkClient],
  controllers: [PosterController],
  exports: [PosterClient, PosterSyncService, WdrinkClient],
})
export class PosterModule {}
