import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const idPattern = /^[a-zA-Z0-9_-]+$/;
const phonePattern = /^\+?[\d\s()-]{10,24}$/;
const namePattern = /^[\p{L}]+(?:[ '’-][\p{L}]+)*$/u;
const streetPattern = /^[\p{L}\p{N}\s.,'’№/()\-]+$/u;
const housePattern = /^(?=.*\p{N})[\p{L}\p{N}\s./\-]+$/u;
const flatPattern =
  /^\p{N}{1,5}[\p{L}]?(?:[/-]\p{N}{1,5}[\p{L}]?)?$/u;

export class OrderModifierDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  posterId?: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  price: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  qty?: number;
}

export class OrderItemDto {
  @IsString()
  @Matches(idPattern)
  productId: string;

  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  /** Выбранные модификаторы Poster: [{posterId, name, price}] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderModifierDto)
  modifiers?: OrderModifierDto[];
}

export class AddressDto {
  @IsString()
  @Length(2, 100)
  @Matches(streetPattern, { message: 'Проверьте название улицы' })
  street: string;

  @IsString()
  @MaxLength(20)
  @Matches(housePattern, { message: 'Проверьте номер дома' })
  house: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Matches(flatPattern, { message: 'Проверьте номер квартиры' })
  flat?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/, { message: 'Подъезд должен быть числом' })
  entrance?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d{1,2}$/, { message: 'Проверьте этаж' })
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
}

export class CreateOrderDto {
  @IsEnum(['DELIVERY', 'PICKUP'])
  type: 'DELIVERY' | 'PICKUP';

  @IsString()
  @MaxLength(24)
  @Matches(phonePattern, { message: 'Неверный формат номера' })
  phone: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(namePattern, { message: 'Проверьте имя' })
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
  @MaxLength(300)
  comment?: string;

  @IsEnum(['CASH', 'CARD_ON_DELIVERY', 'KASPI_ONLINE'])
  paymentMethod: 'CASH' | 'CARD_ON_DELIVERY' | 'KASPI_ONLINE';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Проверьте промокод' })
  promoCode?: string;

  /** Баллы собственного приложения; доступны только авторизованному клиенту. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  pointsToSpend?: number;

  /** Клиент явно отказался от доступной акции, чтобы использовать баллы. */
  @IsOptional()
  @IsBoolean()
  skipPromotions?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
