import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminActor, AdminActorValue } from './admin-actor';
import { AdminGuard } from './admin.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { CreateStaffDto, ResetStaffPasswordDto, SetStaffActiveDto } from './admin-auth.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminStaffController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('staff')
  staff(@AdminActor() actor: AdminActorValue) {
    return this.auth.listStaff(actor.tenantId);
  }

  @Post('staff')
  async create(@AdminActor() actor: AdminActorValue, @Body() dto: CreateStaffDto) {
    const user = await this.auth.createStaff(actor, dto);
    await this.audit.record(actor, {
      action: 'STAFF_CREATED',
      entityType: 'StaffUser',
      entityId: user.id,
      summary: `Создан сотрудник ${user.displayName} (${user.role})`,
    });
    return user;
  }

  @Patch('staff/:id/password')
  async resetPassword(
    @AdminActor() actor: AdminActorValue,
    @Param('id') id: string,
    @Body() dto: ResetStaffPasswordDto,
  ) {
    const result = await this.auth.resetPassword(actor, id, dto.password);
    await this.audit.record(actor, {
      action: 'STAFF_PASSWORD_RESET',
      entityType: 'StaffUser',
      entityId: id,
      summary: 'Пароль сотрудника изменён',
    });
    return result;
  }

  @Patch('staff/:id/active')
  async setActive(
    @AdminActor() actor: AdminActorValue,
    @Param('id') id: string,
    @Body() dto: SetStaffActiveDto,
  ) {
    const user = await this.auth.setActive(actor, id, dto.isActive);
    await this.audit.record(actor, {
      action: dto.isActive ? 'STAFF_ENABLED' : 'STAFF_DISABLED',
      entityType: 'StaffUser',
      entityId: id,
      summary: `${dto.isActive ? 'Доступ включён' : 'Доступ отключён'}: ${user.displayName}`,
    });
    return user;
  }

  @Get('audit')
  auditLog(@AdminActor() actor: AdminActorValue, @Query('take') take?: string) {
    return this.audit.list(actor.tenantId, Number(take) || 200);
  }
}
