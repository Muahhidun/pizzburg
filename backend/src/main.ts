import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Railway стоит за прокси: без этого все запросы приходят с одного
  // адреса балансировщика, и ограничение частоты либо не работает вовсе,
  // либо блокирует всех разом (DECISIONS §12.26).
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  const dryRun = process.env.POSTER_DRY_RUN === '1';
  console.log(
    `API listening on :${port} | Poster dispatch: ${dryRun ? 'DRY RUN (заказы НЕ уходят на планшеты)' : 'БОЕВОЙ РЕЖИМ'}`,
  );
}

bootstrap();
