import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Вход планшета раздачи (docs/COURIER_SYSTEM_SPEC.md §4).
 *
 * Планшет висит на стене круглые сутки, и логин с паролем на нём
 * означал бы ровно то, от чего уходим: «опять выкинуло, кто помнит
 * пароль». Поэтому у устройства свой долгоживущий токен. В базе лежит
 * только sha256, отзыв — выключить устройство в админке.
 */

export interface DispatchDeviceValue {
  id: string;
  tenantId: string;
  venueId: string;
  name: string;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Чаще раза в минуту отметку «был на связи» не пишем */
const SEEN_EVERY_MS = 60_000;

@Injectable()
export class DispatchDeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers['x-device-token'] ?? '');
    if (token.length < 20) throw new UnauthorizedException('Планшет не подключён');

    const device = await this.prisma.dispatchDevice.findUnique({
      where: { tokenHash: hashDeviceToken(token) },
    });
    if (!device || !device.isActive) {
      throw new UnauthorizedException('Планшет отключён или не найден');
    }
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await this.prisma.dispatchDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }
    req.dispatchDevice = {
      id: device.id,
      tenantId: device.tenantId,
      venueId: device.venueId,
      name: device.name,
    } satisfies DispatchDeviceValue;
    return true;
  }
}

export const DispatchDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): DispatchDeviceValue =>
    ctx.switchToHttp().getRequest().dispatchDevice,
);
