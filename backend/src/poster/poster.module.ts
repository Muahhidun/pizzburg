import { Module } from '@nestjs/common';
import { PosterClient } from './poster.client';
import { PosterSyncService } from './poster-sync.service';
import { PosterController } from './poster.controller';

@Module({
  providers: [PosterClient, PosterSyncService],
  controllers: [PosterController],
  exports: [PosterClient, PosterSyncService],
})
export class PosterModule {}
