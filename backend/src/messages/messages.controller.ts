import { Controller, Get, Param } from '@nestjs/common';
import { MessagesService } from './messages.service';

/// Публичная лента: акции и новости видят и гости
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':tenantSlug')
  feed(@Param('tenantSlug') tenantSlug: string) {
    return this.messages.feed(tenantSlug);
  }
}
