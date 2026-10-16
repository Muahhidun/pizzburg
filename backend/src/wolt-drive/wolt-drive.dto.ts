import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateWoltDriveSettingsDto {
  @IsIn(['disabled', 'test', 'production'])
  mode: 'disabled' | 'test' | 'production';

  /** Пустое/отсутствующее поле сохраняет уже записанный ключ. */
  @IsOptional() @IsString() @MaxLength(2_048) merchantKey?: string;
  @IsOptional() @IsString() @MaxLength(200) merchantId?: string;
  @IsString() @MaxLength(200) venueId: string;
  @IsString() @MaxLength(120) city: string;
  @IsOptional() @IsString() @MaxLength(30) postCode?: string;
}

export class WoltDriveQuoteDto {
  @IsInt() @Min(5) @Max(60) preparationTimeMinutes: number;
  @IsInt() @Min(1) @Max(20) bagCount: number;
}

export class CancelWoltDriveDto {
  @IsString() @Length(3, 300) reason: string;
}

export class RegisterWoltDriveWebhookDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  callbackUrl: string;
}

export class WoltDriveWebhookDto {
  @IsString() @Length(20, 20_000) token: string;
}
