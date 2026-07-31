import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { PosterModule } from './poster/poster.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { PromotionsModule } from './promotions/promotions.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Controller()
class RootController {
  /// Подсказка на корне: сюда часто заходят руками и видят 404
  @Get()
  root() {
    return {
      service: 'PizzBurg Delivery API',
      posterDispatch:
        process.env.POSTER_DRY_RUN === '1'
          ? 'DRY RUN — заказы НЕ уходят на планшеты'
          : 'БОЕВОЙ РЕЖИМ — заказы уходят на планшеты Poster',
      приложение: 'http://localhost:3212',
      админка: 'http://localhost:3211',
      endpoints: [
        'GET  /health',
        'GET  /menu/:tenantSlug',
        'POST /cart/:tenantSlug/preview',
        'POST /orders/:tenantSlug',
        'POST /poster/sync/:tenantId',
      ],
    };
  }

  @Get('health')
  health() {
    return { ok: true, ts: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PosterModule,
    MenuModule,
    OrdersModule,
    PromotionsModule,
    AuthModule,
    AdminModule,
  ],
  controllers: [RootController],
})
export class AppModule {}
