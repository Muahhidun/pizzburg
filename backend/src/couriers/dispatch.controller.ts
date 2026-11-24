import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
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

  /** Отменить заказ старого приложения (кассир отменил его в Poster) */
  @Post('tasks/:id/cancel')
  @HttpCode(200)
  cancel(@DispatchDevice() device: DispatchDeviceValue, @Param('id') id: string) {
    return this.board.cancelTask(device, id);
  }

  @Post('tasks/:id/handed-over')
  @HttpCode(200)
  handedOver(@DispatchDevice() device: DispatchDeviceValue, @Param('id') id: string) {
    return this.board.handOver(device, id);
  }

  /** Нажатие на курьера в очереди: «Уехал» — вне очереди, заказ следующему */
  @Post('couriers/:shiftId/away')
  @HttpCode(200)
  courierAway(@DispatchDevice() device: DispatchDeviceValue, @Param('shiftId') shiftId: string) {
    return this.board.courierAway(device, shiftId);
  }

  @Post('couriers/:shiftId/end-shift')
  @HttpCode(200)
  courierEndShift(@DispatchDevice() device: DispatchDeviceValue, @Param('shiftId') shiftId: string) {
    return this.board.courierEndShift(device, shiftId);
  }

  @Get('couriers/:courierId/photo')
  @Header('Cache-Control', 'private, max-age=3600')
  async courierPhoto(
    @DispatchDevice() device: DispatchDeviceValue,
    @Param('courierId') courierId: string,
  ) {
    const file = await this.board.courierPhoto(device, courierId);
    return new StreamableFile(file.data, { type: file.type });
  }
}
