import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Courier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { verifyInitData } from './telegram-init-data';

/**
 * Вход курьера из Mini App: заголовки `X-Tenant` (slug) и
 * `X-Telegram-Init-Data` (подписанные Telegram данные запуска).
 * Пускаем только подтверждённых и ещё не подтверждённых курьеров:
 * последним нужен экран «отсканируйте QR, кассир вас подтвердит».
 */
export interface CourierActorValue {
  courier: Courier;
  tenantId: string;
  tenantSlug: string;
  tenantSettings: unknown;
}

@Injectable()
export class CourierAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const slug = String(req.headers['x-tenant'] ?? '');
    const initData = String(req.headers['x-telegram-init-data'] ?? '');
    if (!slug || !initData) throw new UnauthorizedException('Откройте приложение из бота');

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, settings: true },
    });
    if (!tenant) throw new UnauthorizedException('Откройте приложение из бота');
    const botToken = String(((tenant.settings as any) ?? {}).telegram?.botToken ?? '');
    const user = verifyInitData(initData, botToken);
    if (!user) throw new UnauthorizedException('Откройте приложение из бота заново');

    const courier = await this.prisma.courier.findUnique({
      where: { tenantId_telegramUserId: { tenantId: tenant.id, telegramUserId: String(user.id) } },
    });
    if (!courier || courier.status === 'DRAFT') {
      throw new ForbiddenException('Сначала пройдите регистрацию в боте');
    }
    if (courier.status === 'REJECTED' || courier.status === 'DISABLED') {
      throw new ForbiddenException('Доступ закрыт. Обратитесь к кассиру');
    }
    req.courierActor = {
      courier,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantSettings: tenant.settings,
    } satisfies CourierActorValue;
    return true;
  }
}

export const CourierActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CourierActorValue =>
    ctx.switchToHttp().getRequest().courierActor,
);
