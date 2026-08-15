import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { GeoService } from './geo.service';

/// Подсказки адресов. Публичный эндпоинт: адрес вводят и гости.
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('suggest')
  async suggest(@Query('q') q?: string) {
    const items = await this.geo.suggest(q ?? '');
    return { configured: await this.geo.configured(), items };
  }

  /** Дома выбранной улицы */
  @Get('houses')
  async houses(@Query('street') street?: string, @Query('q') q?: string) {
    return { items: await this.geo.houses(street ?? '', q ?? '') };
  }

  @Get('verify')
  verify(@Query('street') street?: string, @Query('house') house?: string) {
    return this.geo.verify(street ?? '', house ?? '');
  }

  /**
   * «Моего адреса нет в списке». Гость тоже может отправить: он ещё не
   * вошёл, а заказать хочет сейчас.
   */
  @Post('address-request')
  request(@Body() body: { raw?: string; phone?: string }, @Req() req: any) {
    return this.geo.requestAddress(
      'pizzburg',
      body?.raw ?? '',
      req?.customer?.sub,
      body?.phone,
    );
  }
}
