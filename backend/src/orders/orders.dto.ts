import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  qty: number;

  /** Выбранные модификаторы Poster: [{posterId, name, price}] */
  @IsOptional()
  @IsArray()
  modifiers?: { posterId?: string; name: string; price: number }[];
}

export class AddressDto {
  @IsString()
  street: string;

  @IsString()
  house: string;

  @IsOptional()
  @IsString()
  flat?: string;

  @IsOptional()
  @IsString()
  entrance?: string;

  @IsOptional()
  @IsString()
  floor?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateOrderDto {
  @IsEnum(['DELIVERY', 'PICKUP'])
  type: 'DELIVERY' | 'PICKUP';

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  /** Предзаказ на время; отсутствует = как можно скорее */
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsEnum(['CASH', 'CARD_ON_DELIVERY', 'KASPI_ONLINE'])
  paymentMethod: 'CASH' | 'CARD_ON_DELIVERY' | 'KASPI_ONLINE';

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
