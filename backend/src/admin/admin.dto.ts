import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, PromotionKind } from '@prisma/client';

export class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @IsOptional() @IsBoolean() isVisible?: boolean;
}

export class ReorderDto {
  /** id категорий в нужном порядке */
  @IsString({ each: true })
  ids: string[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string | null;
  @IsOptional() @IsString() @MaxLength(1_000) displayDescription?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  displayPhotoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(40) weightLabel?: string | null;
  @IsOptional() @IsBoolean() isHit?: boolean;
  @IsOptional() @IsBoolean() isSpicy?: boolean;
  @IsOptional() @IsBoolean() isNew?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) priceOverride?: number | null;
  @IsOptional() @IsString() appCategoryId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOverride?: number | null;
  @IsOptional() @IsBoolean() isVisible?: boolean;
}

export class PromotionDto {
  @IsString() @Length(1, 120) name: string;
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  code?: string | null;
  /// Тип определяет, какие поля обязательны — проверка в сервисе
  @IsOptional()
  @IsIn([
    'GIFT_FOR_QTY',
    'GIFT_FOR_SUM',
    'PERCENT_OFF',
    'FIXED_OFF',
    'FREE_DELIVERY',
  ])
  kind?: PromotionKind;

  @IsOptional() @IsString() conditionCategoryId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100) conditionQty?: number;
  @IsOptional() @IsInt() @Min(1) minOrderSum?: number | null;

  @IsOptional() @IsString() giftProductId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100) giftQty?: number;
  /// Проценты для PERCENT_OFF, тенге для FIXED_OFF
  @IsOptional() @IsInt() @Min(1) discountValue?: number;
  @IsOptional() @IsInt() @Min(1) maxDiscount?: number | null;

  @IsOptional() @IsBoolean() repeatPerCart?: boolean;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number | null;
  @IsOptional() @IsInt() @Min(1) totalLimit?: number | null;
  @IsOptional() @IsIn(['DELIVERY', 'PICKUP']) orderType?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsISO8601() activeFrom?: string | null;
  @IsOptional() @IsISO8601() activeTo?: string | null;
}

export class UpdateSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) minOrder?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) fee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) freeFrom?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) cashbackPct?: number;
  @IsOptional() @IsBoolean() earnWhenPointsSpent?: boolean;
  @IsOptional() @IsBoolean() allowPointsWithPromotions?: boolean;
  @IsOptional() @IsBoolean() earnOnPromotionalOrders?: boolean;
}

/** Аварийный режим приёма заказов и сообщения клиенту */
export class UpdateOrderingDto {
  @IsOptional()
  @IsEnum(['ALL', 'PICKUP_ONLY', 'CLOSED'])
  mode?: 'ALL' | 'PICKUP_ONLY' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(200) closedMessage?: string;
  @IsOptional() @IsString() @MaxLength(200) pickupOnlyMessage?: string;
}

/** Профиль расписания: обычный, Рамадан, конец года */
export class ScheduleProfileDto {
  @IsString() @Length(1, 40) id: string;
  @IsString() @Length(1, 60) name: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата в формате ГГГГ-ММ-ДД' })
  activeFrom?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата в формате ГГГГ-ММ-ДД' })
  activeTo?: string | null;

  /** { mon: [["10:00","22:00"]], ... }; пустой массив — выходной */
  @IsObject()
  hours: Record<string, [string, string][]>;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ScheduleProfileDto)
  profiles: ScheduleProfileDto[];
}

export class UpdatePreorderDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1440) deliveryLeadMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) pickupLeadMinutes?: number;
  @IsOptional() @IsInt() @Min(5) @Max(120) slotStepMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) displayPaddingMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) closeAsapBeforeMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) maxDaysAhead?: number;
}

export class UpdatePaymentsDto {
  @IsOptional() @IsBoolean() cash?: boolean;
  @IsOptional() @IsBoolean() cardOnDelivery?: boolean;
  @IsOptional() @IsBoolean() kaspiOnline?: boolean;
  @IsOptional() @IsBoolean() askChangeFrom?: boolean;
}

export class UpdateCancellationDto {
  @IsInt() @Min(0) @Max(120) customerWindowMinutes: number;
}

export class CreateAddressDto {
  @IsString() @Length(2, 120) street: string;
  @IsString() @Length(1, 20) house: string;
}

export class UpdateAddressDto {
  @IsOptional() @IsBoolean() isDeliverable?: boolean;
}

export class CreateMessageDto {
  @IsString() @Length(2, 120) title: string;
  @IsString() @Length(2, 4_000) body: string;
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string | null;
  @IsOptional() @IsBoolean() sendPush?: boolean;
}

export class UpdateMessageDto {
  @IsBoolean() isPublished: boolean;
}

export class LoyaltyLevelDto {
  @IsString() @Length(2, 40) name: string;

  /// Потолок 20% — не «на всякий случай», а защита от опечатки: «60»
  /// вместо «6» раздаст шестьдесят процентов оборота до первой сверки.
  @IsInt() @Min(0) @Max(20) cashbackPct: number;

  /// Порог — оборот выполненных заказов за всё время
  @IsInt() @Min(0) @Max(100_000_000) minSpent: number;
}

export class UpdateLoyaltyLevelsDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => LoyaltyLevelDto)
  levels: LoyaltyLevelDto[];
}

export class PublishLegalDto {
  @IsEnum(['OFFER', 'PRIVACY', 'REQUISITES'])
  type: 'OFFER' | 'PRIVACY' | 'REQUISITES';

  @IsString() @Length(3, 200) title: string;
  @IsString() @Length(10, 200_000) content: string;
}

export class CancelReasonDto {
  @IsString() @Length(2, 100) label: string;
  @IsOptional() @IsBoolean() availableToCustomer?: boolean;
}

export class UpdateCancelReasonDto {
  @IsOptional() @IsString() @Length(2, 100) label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() availableToCustomer?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class CancelOrderByAdminDto {
  @IsString() reasonId: string;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

/**
 * Позиции, которых не оказалось (DECISIONS §12.9).
 *
 * Пустой список — «нашлись»: снимает пометку и возвращает заказ в обычный
 * ход, поэтому @ArrayNotEmpty здесь намеренно нет.
 */
export class MarkShortageDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  itemIds: string[];
}

/** Постановка на стоп: срок обязателен (DECISIONS §12.3) */
export class StopItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() appCategoryId?: string;
  @IsIn(['HOUR', 'TWO_HOURS', 'END_OF_DAY', 'NEXT_SHIFT'])
  preset: 'HOUR' | 'TWO_HOURS' | 'END_OF_DAY' | 'NEXT_SHIFT';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ReleaseStopDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() appCategoryId?: string;
}

export class TelegramSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  /// Пустая строка означает «не меняли»: форма не получает токен обратно
  @IsOptional() @IsString() @MaxLength(200) botToken?: string;
  @IsOptional() @IsString() @MaxLength(64) chatId?: string;
}

export class AdjustLoyaltyDto {
  @IsInt() @Min(-10_000_000) @Max(10_000_000) amount: number;
  @IsString() @Length(3, 300) comment: string;
}

export class PosterAccountDto {
  @IsString() @Length(1, 80) name: string;
  @IsString() @Length(10, 500) token: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000) sortOrder?: number;
}
