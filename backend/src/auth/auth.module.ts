import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AddressesService } from './addresses.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { OptionalCustomerAuthGuard } from './optional-customer-auth.guard';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    LoyaltyModule,
    NotificationsModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
      signOptions: { expiresIn: '180d' }, // мобильная сессия живёт долго
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AddressesService,
    CustomerAuthGuard,
    OptionalCustomerAuthGuard,
  ],
  exports: [
    AuthService,
    AddressesService,
    CustomerAuthGuard,
    OptionalCustomerAuthGuard,
  ],
})
export class AuthModule {}
