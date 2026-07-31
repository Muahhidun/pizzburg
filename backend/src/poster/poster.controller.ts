import { Controller, Param, Post } from '@nestjs/common';
import { PosterSyncService } from './poster-sync.service';

/** Ручной запуск синка меню (позже закроем админской авторизацией) */
@Controller('poster')
export class PosterController {
  constructor(private readonly sync: PosterSyncService) {}

  @Post('sync/:tenantId')
  syncTenant(@Param('tenantId') tenantId: string) {
    return this.sync.syncTenant(tenantId);
  }
}
