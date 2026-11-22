import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CourierActor, CourierActorValue, CourierAuthGuard } from './courier-auth.guard';
import { CourierAppService } from './courier-app.service';

class QrDto {
  @IsString() @Length(10, 200) qr: string;
}

class DeliveredDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

class FailedDto {
  @IsString() @Length(2, 300) reason: string;
}

/** API Mini App курьера. Вход — подписанные Telegram данные запуска */
@UseGuards(CourierAuthGuard)
@Controller('courier')
export class CourierAppController {
  constructor(private readonly app: CourierAppService) {}

  @Get('me')
  me(@CourierActor() actor: CourierActorValue) {
    return this.app.me(actor);
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(@CourierActor() actor: CourierActorValue, @Body() dto: QrDto) {
    return this.app.checkIn(actor, dto.qr);
  }

  @Post('tasks/:id/picked-up')
  @HttpCode(200)
  pickedUp(@CourierActor() actor: CourierActorValue, @Param('id') id: string, @Body() dto: QrDto) {
    return this.app.pickedUp(actor, id, dto.qr);
  }

  /** «Забрал без скана» — засчитывается с пометкой */
  @Post('tasks/:id/picked-up-manual')
  @HttpCode(200)
  pickedUpManual(@CourierActor() actor: CourierActorValue, @Param('id') id: string) {
    return this.app.pickedUp(actor, id, null);
  }

  @Post('tasks/:id/delivered')
  @HttpCode(200)
  delivered(
    @CourierActor() actor: CourierActorValue,
    @Param('id') id: string,
    @Body() dto: DeliveredDto,
  ) {
    return this.app.delivered(actor, id, dto.lat, dto.lng);
  }

  @Post('tasks/:id/failed')
  @HttpCode(200)
  failed(@CourierActor() actor: CourierActorValue, @Param('id') id: string, @Body() dto: FailedDto) {
    return this.app.failed(actor, id, dto.reason);
  }

  @Post('pause')
  @HttpCode(200)
  pause(@CourierActor() actor: CourierActorValue) {
    return this.app.pause(actor);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CourierActor() actor: CourierActorValue) {
    return this.app.resume(actor);
  }

  /** «Сдаю кассиру»: карточка с кнопками в чат кассы */
  @Post('cash/hand-in')
  @HttpCode(200)
  handIn(@CourierActor() actor: CourierActorValue) {
    return this.app.handIn(actor);
  }

  @Post('shift/end')
  @HttpCode(200)
  endShift(@CourierActor() actor: CourierActorValue) {
    return this.app.endShift(actor);
  }
}
