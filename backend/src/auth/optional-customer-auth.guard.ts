import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Авторизация необязательна, но переданный испорченный токен не игнорируем. */
@Injectable()
export class OptionalCustomerAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header) return true;
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Неверный формат авторизации');
    try {
      req.customer = await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }
  }
}
