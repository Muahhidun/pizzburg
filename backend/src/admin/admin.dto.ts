import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isVisible?: boolean;
}

export class ReorderDto {
  /** id категорий в нужном порядке */
  @IsString({ each: true })
  ids: string[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() displayName?: string | null;
  @IsOptional() @IsString() displayDescription?: string | null;
  @IsOptional() @IsInt() @Min(0) priceOverride?: number | null;
  @IsOptional() @IsString() appCategoryId?: string;
  @IsOptional() @IsInt() sortOverride?: number | null;
  @IsOptional() @IsBoolean() isVisible?: boolean;
}

export class PromotionDto {
  @IsString() name: string;
  @IsOptional() @IsString() code?: string | null;
  @IsString() conditionCategoryId: string;
  @IsInt() @Min(1) conditionQty: number;
  @IsString() giftProductId: string;
  @IsOptional() @IsInt() @Min(1) giftQty?: number;
  @IsOptional() @IsBoolean() repeatPerCart?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsISO8601() activeFrom?: string | null;
  @IsOptional() @IsISO8601() activeTo?: string | null;
}

export class UpdateSettingsDto {
  @IsOptional() @IsInt() @Min(0) minOrder?: number;
  @IsOptional() @IsInt() @Min(0) fee?: number;
  @IsOptional() @IsInt() @Min(0) freeFrom?: number;
}

export class PosterAccountDto {
  @IsString() name: string;
  @IsString() token: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
