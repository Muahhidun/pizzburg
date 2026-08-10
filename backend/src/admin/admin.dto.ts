import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';

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
  @IsString() conditionCategoryId: string;
  @IsInt() @Min(1) @Max(100) conditionQty: number;
  @IsString() giftProductId: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) giftQty?: number;
  @IsOptional() @IsBoolean() repeatPerCart?: boolean;
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

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;
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
