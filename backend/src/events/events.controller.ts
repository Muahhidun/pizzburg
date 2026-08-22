import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OptionalCustomerAuthGuard } from '../auth/optional-customer-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, MAX_EVENTS_PER_BATCH } from './events.service';

class EventDto {
  @IsString() @MaxLength(40) type: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

class EventBatchDto {
  @IsOptional() @IsString() @MaxLength(64) deviceId?: string;

  @IsArray()
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => EventDto)
  events: EventDto[];
}

/**
 * Приём поведенческих событий (DECISIONS §12.24).
 *
 * Без обязательного входа: меню смотрят и не входя, и это поведение
 * тоже надо видеть. Гость опознаётся по устройству.
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':tenantSlug')
  @UseGuards(OptionalCustomerAuthGuard)
  async record(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: EventBatchDto,
    @Req() req: any,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Unknown tenant');

    return this.events.record(tenant.id, dto.events, {
      customerId: req.customer?.sub ?? null,
      deviceId: dto.deviceId,
    });
  }
}
