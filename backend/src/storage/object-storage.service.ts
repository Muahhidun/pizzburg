import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
};

const acceptedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  async uploadProductImage(
    productId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    if (!acceptedImageTypes.has(file.mimetype)) {
      throw new BadRequestException(
        'Поддерживаются только JPEG, PNG, WebP и HEIC',
      );
    }

    const config = this.storageConfig();
    let body: Buffer;
    try {
      body = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: 1_600,
          height: 1_600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 84, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Файл не является корректным изображением');
    }

    const key = `products/${productId}/${randomUUID()}.webp`;
    try {
      await this.client(config).send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Object storage upload failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException(
        'Не удалось загрузить фото в хранилище',
      );
    }

    return `${config.publicUrl}/${key}`;
  }

  async deleteIfManaged(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const config = this.storageConfig(false);
    if (!config) return;

    const prefix = `${config.publicUrl}/`;
    if (!url.startsWith(prefix)) return;
    const key = url.slice(prefix.length);
    if (!key.startsWith('products/')) return;

    try {
      await this.client(config).send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not remove old image ${key}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private storageConfig(required?: true): StorageConfig;
  private storageConfig(required: false): StorageConfig | null;
  private storageConfig(required = true): StorageConfig | null {
    const bucket = this.configService.get<string>('OBJECT_STORAGE_BUCKET');
    const accessKeyId = this.configService.get<string>(
      'OBJECT_STORAGE_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    );
    const publicUrl = this.configService
      .get<string>('OBJECT_STORAGE_PUBLIC_URL')
      ?.replace(/\/+$/, '');

    if (!bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
      if (!required) return null;
      throw new ServiceUnavailableException(
        'Хранилище фотографий ещё не настроено',
      );
    }

    return {
      bucket,
      region: this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto',
      endpoint: this.configService.get<string>('OBJECT_STORAGE_ENDPOINT'),
      accessKeyId,
      secretAccessKey,
      publicUrl,
      forcePathStyle:
        this.configService.get<string>('OBJECT_STORAGE_FORCE_PATH_STYLE') ===
        '1',
    };
  }

  private client(config: StorageConfig) {
    return new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
}
