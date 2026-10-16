import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WoltDriveWebhookDto } from './wolt-drive.dto';
import { WoltDriveService } from './wolt-drive.service';

/** Публичная точка только для подписанных Wolt JWT; admin-token здесь не нужен. */
@Controller('wolt-drive')
export class WoltDriveController {
  constructor(private readonly woltDrive: WoltDriveService) {}

  @Post('webhooks')
  @HttpCode(204)
  async webhook(@Body() dto: WoltDriveWebhookDto) {
    await this.woltDrive.receiveWebhook(dto.token);
  }
}
