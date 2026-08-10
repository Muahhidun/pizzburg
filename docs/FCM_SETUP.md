# Firebase Cloud Messaging: подключение PizzBurg

Код уведомлений подключён к backend и Flutter. Firebase-проект,
Railway backend и нативная конфигурация iOS настроены 10 августа 2026 года.
До первого теста на реальном iPhone осталось загрузить APNs-ключ Apple в
Firebase и подписать сборку активной командой Apple Developer.

## Текущий статус

- Firebase-проект: `pizzburg-delivery`;
- iOS Bundle ID: `kz.pizzburg.pizzburg`;
- Railway backend: FCM включён, в логах подтверждено
  `FCM готов к отправке уведомлений`;
- `GoogleService-Info.plist` добавлен в target `Runner`;
- включены **Push Notifications** и **Background Modes** (`Background fetch`,
  `Remote notifications`);
- release-сборка iOS без подписи проходит;
- APNs Auth Key в Firebase: ещё не загружен;
- тест на реальном iPhone: ещё не проведён.

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
2. Использовать созданный проект `pizzburg-delivery`.
3. Отдельную Firebase Database создавать не нужно.

## 2. Подключить backend в Railway

1. Firebase Console → **Project settings** → **Service accounts**.
2. Нажать **Generate new private key** и сохранить JSON только на своём
   компьютере. Этот файл нельзя коммитить или пересылать в чат.
3. Превратить JSON в одну строку base64 и скопировать в буфер macOS:

   ```bash
   base64 -i firebase-service-account.json | tr -d '\n' | pbcopy
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

1. В Firebase зарегистрировано iOS-приложение с Bundle ID
   `kz.pizzburg.pizzburg`.
2. `GoogleService-Info.plist` уже добавлен в `mobile/ios/Runner` и target
   `Runner`.
3. В Xcode уже включены **Push Notifications** и **Background Modes** с
   **Background fetch** и **Remote notifications**.
4. Apple Developer → Keys: создать APNs Auth Key (`.p8`), записать Key ID и
   Team ID. Firebase Console → Project settings → Cloud Messaging → iOS app →
   загрузить этот APNs key.
5. Для проверки сборки на Mac в папке `mobile` выполнить:

   ```bash
   flutter build ios --release --no-codesign
   ```

6. После настройки подписи установить приложение на реальный iPhone, при
   первом запуске разрешить уведомления и войти по номеру телефона.

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
