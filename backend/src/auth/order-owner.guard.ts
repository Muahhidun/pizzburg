import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Заказ принадлежит тому, кто его открывает (DECISIONS §12.26).
 *
 * Ставится **после** `CustomerAuthGuard`: тот доказывает, кто пришёл,
 * этот — что заказ его. Одного токена мало: с ним можно было бы читать
 * чужие заказы, перебирая идентификаторы.
 *
 * Чужой заказ отдаём как «не найден», а не «нельзя». Разница в ответах
 * сама по себе утечка: по ней перебором выясняется, какие
 * идентификаторы существуют.
 */
@Injectable()
export class OrderOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orderId = req.params?.orderId;
    const customerId = req.customer?.sub;
    if (!orderId) throw new NotFoundException('Заказ не найден');
    if (!customerId) throw new ForbiddenException('Нужна авторизация');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return true;
  }
}
