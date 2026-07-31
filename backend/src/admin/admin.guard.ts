import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Простая защита админки статическим токеном (ADMIN_TOKEN в .env).
 * Роли и полноценные аккаунты сотрудников — после v1.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('ADMIN_TOKEN не настроен на сервере');
    }
    const req = ctx.switchToHttp().getRequest();
    const got = req.headers['x-admin-token'];
    if (got !== expected) throw new UnauthorizedException('Неверный токен');
    return true;
  }
}
