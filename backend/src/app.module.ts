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
import { LoyaltyModule } from './loyalty/loyalty.module';
import { AvailabilityModule } from './availability/availability.module';
import { FavoritesModule } from './favorites/favorites.module';
import { MessagesModule } from './messages/messages.module';
import { GeoModule } from './geo/geo.module';
import { LegalModule } from './legal/legal.module';
import { StopListModule } from './stoplist/stoplist.module';
import { UpsellModule } from './upsell/upsell.module';
import { EventsModule } from './events/events.module';
import { SmsModule } from './sms/sms.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TelegramModule } from './telegram/telegram.module';

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
    AvailabilityModule,
    LegalModule,
    StopListModule,
    UpsellModule,
    EventsModule,
    SmsModule,
    /**
     * Общий потолок частоты (DECISIONS §12.26).
     *
     * Публичный API печатает на живые планшеты и оплачивает SMS: без
     * предела скрипт сжигает и бумагу, и баланс. Здесь широкий потолок
     * «на всякого» — точечные лимиты стоят на самих маршрутах.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 10_000, limit: 30 },
      { name: 'long', ttl: 60_000, limit: 120 },
    ]),
    TelegramModule,
    GeoModule,
    FavoritesModule,
    MessagesModule,
    PosterModule,
    MenuModule,
    OrdersModule,
    PromotionsModule,
    AuthModule,
    LoyaltyModule,
    AdminModule,
  ],
  controllers: [RootController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
