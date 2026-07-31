import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
      signOptions: { expiresIn: '180d' }, // мобильная сессия живёт долго
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CustomerAuthGuard],
  exports: [AuthService, CustomerAuthGuard],
})
export class AuthModule {}
