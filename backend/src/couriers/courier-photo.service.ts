import { Injectable } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service';

/**
 * Селфи курьеров из Telegram — для очереди с лицами в Mini App и на
 * планшете раздачи. Обе стороны опрашивают раз в несколько секунд, поэтому
 * скачанное держим в памяти (не больше 50 фото).
 */
@Injectable()
export class CourierPhotoService {
  private readonly cache = new Map<string, { data: Buffer; type: string }>();

  constructor(private readonly telegram: TelegramService) {}

  async get(tenantId: string, fileId: string): Promise<{ data: Buffer; type: string } | null> {
    const hit = this.cache.get(fileId);
    if (hit) return hit;
    const file = await this.telegram.downloadFile(tenantId, fileId);
    if (!file) return null;
    if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(fileId, file);
    return file;
  }
}
