import { BadRequestException } from '@nestjs/common';

/** Приводит казахстанский номер к единому формату +7XXXXXXXXXX. */
export function normalizeKzPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+7${digits}`;
  }
  throw new BadRequestException('Неверный формат номера');
}
