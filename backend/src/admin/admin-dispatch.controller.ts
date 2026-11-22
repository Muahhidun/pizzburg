import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { DispatchBoardService } from '../couriers/dispatch-board.service';
import { AdminActor, AdminActorValue } from './admin-actor';
import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin.guard';

class CreateDispatchDeviceDto {
  @IsString() @Length(1, 60) name: string;
  @IsOptional() @IsString() @Length(1, 40) venueId?: string;
}

class SetDispatchDeviceActiveDto {
  @IsBoolean() isActive: boolean;
}

/**
 * Планшеты раздачи. Только владелец (по умолчанию AdminGuard закрывает
 * маршруты от кассира): токен планшета — постоянный вход на доску.
 */
@Controller('admin/dispatch-devices')
@UseGuards(AdminGuard)
export class AdminDispatchController {
  constructor(
    private readonly board: DispatchBoardService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@AdminActor() actor: AdminActorValue) {
    return this.board.listDevices(actor.tenantId);
  }

  @Post()
  async create(@AdminActor() actor: AdminActorValue, @Body() dto: CreateDispatchDeviceDto) {
    const device = await this.board.createDevice(actor.tenantId, dto.name, dto.venueId);
    await this.audit.record(actor, {
      action: 'DISPATCH_DEVICE_CREATED',
      entityType: 'DispatchDevice',
      entityId: device.id,
      summary: `Подключён планшет раздачи «${device.name}»`,
    });
    return device;
  }

  @Patch(':id')
  async setActive(
    @AdminActor() actor: AdminActorValue,
    @Param('id') id: string,
    @Body() dto: SetDispatchDeviceActiveDto,
  ) {
    const result = await this.board.setDeviceActive(actor.tenantId, id, dto.isActive);
    await this.audit.record(actor, {
      action: dto.isActive ? 'DISPATCH_DEVICE_ENABLED' : 'DISPATCH_DEVICE_DISABLED',
      entityType: 'DispatchDevice',
      entityId: id,
      summary: dto.isActive ? 'Планшет раздачи включён' : 'Планшет раздачи отключён',
    });
    return result;
  }
}
