import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { DispatchBoardService } from './dispatch-board.service';
import {
  DispatchDevice,
  DispatchDeviceGuard,
  DispatchDeviceValue,
} from './dispatch-device.guard';

/**
 * API планшета раздачи. Вход — токен устройства, не админский.
 *
 * Общий лимит частоты не применяем: планшет опрашивает доску каждые
 * несколько секунд и делит внешний IP заведения с кассой. Подобрать
 * 32-байтный токен перебором нельзя, так что лимит здесь только мешал бы.
 */
class ExtraTripDto {
  @IsInt() @Min(1) @Max(10_000_000) number: number;
  @IsString() @Length(2, 200) reason: string;
}

@SkipThrottle()
@UseGuards(DispatchDeviceGuard)
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly board: DispatchBoardService) {}

  @Get('board')
  getBoard(@DispatchDevice() device: DispatchDeviceValue) {
    return this.board.board(device);
  }

  @Post('tasks/:id/ready')
  @HttpCode(200)
  ready(@DispatchDevice() device: DispatchDeviceValue, @Param('id') id: string) {
    return this.board.markReady(device, id);
  }

  @Post('tasks/:id/undo-ready')
  @HttpCode(200)
  undoReady(@DispatchDevice() device: DispatchDeviceValue, @Param('id') id: string) {
    return this.board.undoReady(device, id);
  }

  @Post('extra-trips')
  @HttpCode(200)
  extraTrip(@DispatchDevice() device: DispatchDeviceValue, @Body() dto: ExtraTripDto) {
    return this.board.createExtraTrip(device, dto.number, dto.reason);
  }

  @Post('tasks/:id/handed-over')
  @HttpCode(200)
  handedOver(@DispatchDevice() device: DispatchDeviceValue, @Param('id') id: string) {
    return this.board.handOver(device, id);
  }
}
