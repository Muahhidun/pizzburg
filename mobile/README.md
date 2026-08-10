# PizzBurg Flutter

Клиент доставки PizzBurg для iOS, Android и web.

## Локальный запуск

```bash
flutter pub get
flutter run -d chrome --dart-define=API_URL=http://127.0.0.1:3210
```

Для реального iPhone вместо `127.0.0.1` нужен локальный IP компьютера:

```bash
flutter run --dart-define=API_URL=http://<IP-Mac>:3210
```

Если запуск через Xcode Automation зависает, см. раздел установки iPhone в
[`docs/HANDOFF.md`](../docs/HANDOFF.md).

## Push-уведомления

Приложение работает без Firebase, но push в этом режиме отключены. Нативные
файлы конфигурации, APNs и staging-тест описаны в
[`docs/FCM_SETUP.md`](../docs/FCM_SETUP.md).
