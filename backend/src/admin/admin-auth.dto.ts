import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { StaffRole } from '@prisma/client';

export class AdminLoginDto {
  @IsString() @Length(3, 50) username: string;
  @IsString() @Length(8, 200) password: string;
}

export class CreateStaffDto {
  @IsString() @Length(3, 50)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Логин: только латинские буквы, цифры, ., _ и -' })
  username: string;
  @IsString() @Length(2, 80) displayName: string;
  @IsString() @Length(8, 200) password: string;
  @IsEnum(StaffRole) role: StaffRole;
}

export class ResetStaffPasswordDto {
  @IsString() @Length(8, 200) password: string;
}

export class SetStaffActiveDto {
  @IsBoolean() isActive: boolean;
}

export class TemporaryOrderingDto {
  @IsIn(['ALL', 'PICKUP_ONLY', 'CLOSED'])
  mode: 'ALL' | 'PICKUP_ONLY' | 'CLOSED';
  @IsOptional() @IsIn([30, 60, 120]) durationMinutes?: 30 | 60 | 120;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
