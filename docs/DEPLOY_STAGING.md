# Развёртывание

**Боевой адрес API: `https://api.pizzburg.kz`.**

Старый `pizzburg-staging-production.up.railway.app` продолжает работать, но в
сборки его класть нельзя: адрес зашивается в бинарник, и приложение,
уехавшее в магазин со старым адресом, останется на нём навсегда.

Сборка приложения:

```
flutter build ios --release --dart-define=API_URL=https://api.pizzburg.kz
flutter build appbundle --release --dart-define=API_URL=https://api.pizzburg.kz
```

Без `--dart-define` релизная сборка не запустится: покажет красный экран
с текстом ошибки вместо пустого приложения.

---

# PizzBurg: Cloudflare R2 и Railway staging

Пошаговая инструкция для владельца. Staging должен быть безопасным:
`POSTER_DRY_RUN=1`, `OTP_DEV_MODE=1`, отдельная база и отдельный bucket.

## 1. Cloudflare R2: bucket для фото

### 1.1. Создать bucket

1. Войти в Cloudflare Dashboard.
2. Открыть **Storage & databases → R2 Object Storage**.
3. Если Cloudflare просит активировать R2/добавить способ оплаты —
   пройти этот шаг.
4. Нажать **Create bucket**.
5. Имя: `pizzburg-media-staging`.
6. Location и storage class оставить по умолчанию и нажать **Create bucket**.

Для production позже создать отдельный `pizzburg-media-production`.

### 1.2. Создать S3-ключи

1. На странице **R2 Overview** найти **API Tokens** и нажать **Manage**.
2. Нажать **Create Account API token** (либо User API token, если
   в аккаунте нет прав на account token).
3. Имя: `pizzburg-staging-backend`.
4. Permissions: **Object Read & Write**.
5. Scope: **Apply to specific buckets only** → `pizzburg-media-staging`.
6. Создать token.
7. Сразу сохранить два значения:
   - `Access Key ID`;
   - `Secret Access Key`.

`Secret Access Key` повторно не показывается. Нам не нужен обычный
Cloudflare API Token — backend использует именно эту S3-пару.

### 1.3. Включить публичное чтение для staging

1. Открыть bucket `pizzburg-media-staging` → **Settings**.
2. В блоке **Public Development URL** нажать **Enable**.
3. Ввести `allow` и подтвердить.
4. Скопировать адрес вида `https://pub-....r2.dev` без слеша в конце.

`r2.dev` подходит для staging. Для боевого приложения нужно подключить
домен вида `media.pizzburg.kz`: bucket → **Settings → Custom Domains → Add**.

### 1.4. Подготовить переменные

Записать для сервиса backend в Railway:

```dotenv
OBJECT_STORAGE_BUCKET=pizzburg-media-staging
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_ENDPOINT=https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
OBJECT_STORAGE_ACCESS_KEY_ID=<Access Key ID>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<Secret Access Key>
OBJECT_STORAGE_PUBLIC_URL=https://pub-....r2.dev
OBJECT_STORAGE_FORCE_PATH_STYLE=0
```

`ACCOUNT_ID` виден в **R2 Overview**. Endpoint не должен содержать имя bucket.
Слеш в конце `OBJECT_STORAGE_PUBLIC_URL` не ставить. CORS для R2 сейчас
не нужен: браузер отправляет файл на наш backend, а backend — в R2.

## 2. Railway staging

### 2.1. Создать проект и базу

1. В Railway нажать **New Project → Empty Project**.
2. Назвать проект `pizzburg-staging`.
3. На canvas нажать **Create/New → Database → PostgreSQL**.
4. Переименовать сервис базы в `Postgres`, чтобы ссылка
   `${{Postgres.DATABASE_URL}}` совпадала с именем сервиса.

### 2.2. Создать backend

1. **Create → Empty Service**, имя `backend`.
2. Открыть `backend` → **Settings → Source** и подключить
   GitHub-репозиторий `Muahhidun/pizzburg`, ветка `main`.
3. В **Root Directory** указать `/backend`.
4. В **Build** указать:

   ```text
   npm ci && npx prisma generate && npm run build
   ```

5. В **Pre-deploy Command** указать:

   ```text
   npx prisma db push && npx tsx prisma/seed.ts
   ```

   Для staging `db push` допустим. Для production перед запуском нужны
   фиксированные Prisma migrations и `prisma migrate deploy`.
6. В **Start Command** указать `npm run start`.
7. В **Healthcheck Path** указать `/health`.

### 2.3. Задать backend variables

Открыть `backend` → **Variables → Raw Editor** и добавить:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
TZ=Asia/Almaty
POSTER_DRY_RUN=1
OTP_DEV_MODE=1
JWT_SECRET=<случайная строка не короче 32 байт>
ADMIN_TOKEN=<отдельная случайная строка>
OBJECT_STORAGE_BUCKET=pizzburg-media-staging
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_ENDPOINT=https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
OBJECT_STORAGE_ACCESS_KEY_ID=<Access Key ID>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<Secret Access Key>
OBJECT_STORAGE_PUBLIC_URL=https://pub-....r2.dev
OBJECT_STORAGE_FORCE_PATH_STYLE=0
```

Секреты можно сгенерировать двумя отдельными вызовами:

```bash
openssl rand -hex 32
```

Не задавать `PORT`: Railway передаст его сам, а backend уже читает
`process.env.PORT`. Нажать **Deploy**.

### 2.4. Проверить backend

1. Дождаться зелёного deployment.
2. В `backend` открыть **Settings → Networking → Generate Domain**.
3. Открыть `https://<backend-domain>/health`. Ожидаем:

   ```json
   {"ok":true,"ts":"..."}
   ```

4. Открыть корень `https://<backend-domain>/` и убедиться, что
   написано **DRY RUN — заказы НЕ уходят на планшеты**.

Если pre-deploy завершился ошибкой, сначала смотреть его логи; не
добавлять `--accept-data-loss`.

### 2.5. Создать admin

1. **Create → Empty Service**, имя `admin`.
2. В **Settings → Source** подключить тот же `Muahhidun/pizzburg`, ветка `main`.
3. **Root Directory**: `/admin`.
4. **Build Command**:

   ```text
   npm ci && npm run build
   ```

5. **Start Command**: `npm run start`.
6. В **Variables** добавить:

   ```dotenv
   NODE_ENV=production
   NEXT_PUBLIC_API_URL=https://<backend-domain>
   ```

   Слеш в конце URL не ставить. `NEXT_PUBLIC_API_URL` встраивается при
   `next build`, поэтому после его изменения нужен redeploy admin.
7. Нажать **Deploy**.
8. После успешного деплоя: **Settings → Networking → Generate Domain**.
9. Открыть admin-domain и войти через значение `ADMIN_TOKEN`.

### 2.6. Заполнить staging и проверить R2

1. В admin открыть **Настройки** и задать:
   - минимальный заказ: `1200`;
   - доставка: `600`;
   - бесплатно от: `5000`.
2. В той же вкладке добавить Poster-аккаунты:
   - `Основной`, sort order `0`, его токен;
   - `Sunday`, sort order `1`, его токен.
3. Открыть **Витрина** и нажать **Синхронизировать с Poster**.
   Это чтение меню; `POSTER_DRY_RUN=1` блокирует отправку заказов.
4. Открыть любой товар в Витрине, загрузить JPEG/PNG и сохранить.
5. Перезагрузить страницу. Фото должно остать и открываться по
   адресу `OBJECT_STORAGE_PUBLIC_URL/products/...webp`.
6. В R2 открыть bucket → **Objects** и убедиться, что файл появился
   в `products/<productId>/...webp`.

## 3. Критерий готовности staging

- `/health` отвечает `ok: true`.
- В корне backend явно указан `DRY RUN`.
- Admin открывается и входит по `ADMIN_TOKEN`.
- Синк обоих Poster-аккаунтов завершается без ошибки.
- Фото после загрузки видно и в admin, и по публичному URL R2.
- Тестовый checkout создаёт заказ в staging DB, но не отправляет его
  кассирам.

Только после этого можно привязывать Flutter staging-сборку к публичному backend URL.

## Официальные справки

- Cloudflare R2: [S3 API и создание ключей](https://developers.cloudflare.com/r2/get-started/s3/),
  [публичные bucket и custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- Railway: [деплой монорепозитория](https://docs.railway.com/guides/deploying-a-monorepo),
  [PostgreSQL](https://docs.railway.com/databases/postgresql),
  [reference variables](https://docs.railway.com/variables),
  [pre-deploy command](https://docs.railway.com/deployments/pre-deploy-command).
