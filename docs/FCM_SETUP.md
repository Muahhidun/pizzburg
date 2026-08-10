# Firebase Cloud Messaging: подключение PizzBurg

Код уведомлений уже подключён к backend и Flutter. Пока Firebase не настроен,
приложение и приём заказов продолжают работать, а FCM тихо отключён.

## Что уже реализовано

- отдельный push-токен для каждой установки приложения (`PushDevice`);
- привязка и отвязка токена при входе/выходе клиента;
- автоматическая очистка недействительных токенов;
- уведомления при статусах `ACCEPTED`, `COOKING`, `READY`, `ON_WAY`,
  `DELIVERED`, `CANCELLED`;
- переход из уведомления на экран заказа;
- показ уведомления внутри открытого приложения;
- обычный опрос статуса остаётся резервным каналом;
- сбой Firebase не мешает принять заказ, изменить статус или начислить баллы.

## 1. Создать проект Firebase

1. Открыть [Firebase Console](https://console.firebase.google.com/).
2. Создать проект, например `pizzburg`.
3. Включить Cloud Messaging. Отдельную Firebase Database создавать не нужно.

## 2. Подключить backend в Railway

1. Firebase Console → **Project settings** → **Service accounts**.
2. Нажать **Generate new private key** и сохранить JSON только на своём
   компьютере. Этот файл нельзя коммитить или пересылать в чат.
3. Превратить JSON в одну строку base64:

   ```bash
   base64 -i firebase-service-account.json | tr -d '\n'
   ```

4. Railway → staging-проект → сервис `backend` → **Variables**. Добавить:

   ```text
   FIREBASE_SERVICE_ACCOUNT_JSON=<полученная base64-строка>
   FIREBASE_PROJECT_ID=<project_id из JSON>
   FCM_ENABLED=1
   ```

5. Сделать redeploy backend и проверить в логах строку
   `FCM готов к отправке уведомлений`.

`FCM_ENABLED=0` полностью выключает отправку без удаления ключей.

## 3. Подключить iPhone

1. Firebase Console → **Project settings** → **Your apps** → добавить iOS app.
2. Bundle ID: `kz.pizzburg.pizzburg`.
3. Скачать `GoogleService-Info.plist` и добавить в
   `mobile/ios/Runner` через Xcode с включённым **Copy items if needed** и target
   `Runner`.
4. Xcode → Runner → **Signing & Capabilities**:
   - добавить **Push Notifications**;
   - добавить **Background Modes** и включить **Remote notifications**.
5. Apple Developer → Keys: создать APNs Auth Key (`.p8`), записать Key ID и
   Team ID. Firebase Console → Project settings → Cloud Messaging → iOS app →
   загрузить этот APNs key.
6. На Mac в папке `mobile` выполнить:

   ```bash
   dart pub global activate flutterfire_cli
   flutterfire configure
   flutter run
   ```

7. При первом запуске разрешить уведомления и войти по номеру телефона.

## 4. Android

Firebase app создаётся с package name `kz.pizzburg.pizzburg`. После скачивания
`google-services.json` положить его в `mobile/android/app/` и снова выполнить
`flutterfire configure`. Разрешение уведомлений Android 13+ уже добавлено в
манифест.

## 5. Временная конфигурация через `dart-define`

Для web или запуска без нативных файлов клиент также понимает:

```text
FIREBASE_API_KEY
FIREBASE_APP_ID
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_PROJECT_ID
FIREBASE_AUTH_DOMAIN
FIREBASE_STORAGE_BUCKET
FIREBASE_WEB_VAPID_KEY
FIREBASE_IOS_BUNDLE_ID
```

Для фоновых web-push дополнительно нужен `firebase-messaging-sw.js`. Это не
блокирует iPhone/Android и может быть подключено отдельно, когда появится
публичный web-домен приложения.

## 6. Проверка на staging

1. Оставить `POSTER_DRY_RUN=1`, чтобы тест не ушёл кассирам.
2. Войти в Flutter-приложение на реальном iPhone и разрешить уведомления.
3. Оформить тестовый заказ.
4. В админке последовательно менять статусы: **Принять**, **Готовится**,
   **Готов**, **В пути**, **Доставлен**.
5. На каждом статусе сверить текст push и переход на правильный заказ.
6. Проверить push при свёрнутом и полностью закрытом приложении.
7. Выйти из профиля: последующие уведомления на устройство приходить не должны.

