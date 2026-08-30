import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

export const ADMIN_ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: StaffRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export interface AdminActorValue {
  id: string | null;
  tenantId: string;
  username: string;
  displayName: string;
  role: StaffRole;
  legacy: boolean;
}

export const AdminActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminActorValue =>
    context.switchToHttp().getRequest().adminActor,
);
