import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROLES_KEY, AdminActorValue } from './admin-actor';

/**
 * Вход сотрудников и проверка роли на каждом запросе.
 * По умолчанию любой маршрут доступен только OWNER.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const raw = String(req.headers['x-admin-token'] ?? '');
    if (!raw) throw new UnauthorizedException('Требуется вход');

    const expected = process.env.ADMIN_TOKEN;
    const actor = expected && raw === expected
      ? await this.legacyActor()
      : await this.jwtActor(raw);
    req.adminActor = actor;

    const allowed =
      this.reflector.getAllAndOverride<StaffRole[]>(ADMIN_ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [StaffRole.OWNER];
    if (!allowed.includes(actor.role)) {
      throw new ForbiddenException('У вашей роли нет доступа к этой функции');
    }
    return true;
  }

  private async legacyActor(): Promise<AdminActorValue> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: 'pizzburg' } });
    if (!tenant) throw new UnauthorizedException('Аккаунт заведения не найден');
    const namedOwnerExists = await this.prisma.staffUser.count({
      where: { tenantId: tenant.id, role: StaffRole.OWNER, isActive: true },
    });
    if (namedOwnerExists) {
      throw new UnauthorizedException(
        'Старый общий токен отключён. Войдите под личным логином',
      );
    }
    return {
      id: null,
      tenantId: tenant.id,
      username: 'owner',
      displayName: 'Владелец',
      role: StaffRole.OWNER,
      legacy: true,
    };
  }

  private async jwtActor(raw: string): Promise<AdminActorValue> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(raw);
    } catch {
      throw new UnauthorizedException('Сессия истекла. Войдите снова');
    }
    if (payload.kind === 'admin-legacy' && payload.tenantId) return this.legacyActor();
    if (payload.kind !== 'admin' || !payload.sub) {
      throw new UnauthorizedException('Неверный тип сессии');
    }
    const user = await this.prisma.staffUser.findUnique({ where: { id: payload.sub } });
    if (
      !user || !user.isActive || user.tenantId !== payload.tenantId ||
      user.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('Доступ отключён или сессия устарела');
    }
    return {
      id: user.id,
      tenantId: user.tenantId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      legacy: false,
    };
  }
}
