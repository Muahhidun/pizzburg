import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/** Достаёт клиента из Bearer-токена; кладёт payload в request.customer */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Нужна авторизация');

    let payload: { sub?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    // Токен живёт своим сроком и об удалении аккаунта не знает: без этой
    // проверки сохранённый токен продолжал работать после удаления, и
    // им можно было оформлять заказы от лица стёртого профиля
    // (DECISIONS §12.33).
    const customer = payload.sub
      ? await this.prisma.customer.findUnique({
          where: { id: payload.sub },
          select: { deletedAt: true },
        })
      : null;
    if (!customer || customer.deletedAt) {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    req.customer = payload;
    return true;
  }
}
