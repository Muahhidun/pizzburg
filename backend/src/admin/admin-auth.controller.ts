import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './admin-auth.dto';
import { AdminActor, AdminActorValue, AdminRoles } from './admin-actor';
import { AdminGuard } from './admin.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @AdminRoles(StaffRole.OWNER, StaffRole.CASHIER)
  me(@AdminActor() actor: AdminActorValue) {
    return actor;
  }
}
