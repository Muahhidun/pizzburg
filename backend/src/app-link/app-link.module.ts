import { Module } from '@nestjs/common';
import { AppLinkController } from './app-link.controller';

@Module({ controllers: [AppLinkController] })
export class AppLinkModule {}
