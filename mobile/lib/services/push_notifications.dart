import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

enum PushNotificationsStatus {
  checking,
  notRequested,
  requesting,
  enabled,
  denied,
  unavailable,
  error,
}

/// Подключает FCM, регистрирует токен установки в нашем backend и передаёт
/// события интерфейсу. До добавления Firebase-конфигурации тихо отключается,
/// поэтому локальный web/staging продолжает запускаться.
class PushNotificationsService extends ChangeNotifier {
  static const _webVapidKey = String.fromEnvironment('FIREBASE_WEB_VAPID_KEY');
  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const _messagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
  );
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _authDomain = String.fromEnvironment('FIREBASE_AUTH_DOMAIN');
  static const _storageBucket = String.fromEnvironment(
    'FIREBASE_STORAGE_BUCKET',
  );
  static const _iosBundleId = String.fromEnvironment(
    'FIREBASE_IOS_BUNDLE_ID',
    defaultValue: 'kz.pizzburg.pizzburg',
  );

  final ApiClient api;
  FirebaseMessaging? _messaging;
  String? _token;
  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _foregroundMessages;
  StreamSubscription<RemoteMessage>? _openedMessages;
  Future<void>? _initialization;
  bool _permissionGranted = false;
  bool _listenersAttached = false;
  PushNotificationsStatus _status = PushNotificationsStatus.checking;
  String? _lastError;

  void Function(String title, String body)? onForegroundMessage;
  void Function(Map<String, dynamic> data)? onNotificationOpened;

  PushNotificationsService(this.api);

  PushNotificationsStatus get status => _status;
  String? get lastError => _lastError;

  Future<void> initialize() {
    return _initialization ??= _initialize();
  }

  Future<void> _initialize() async {
    try {
      if (!await _initializeFirebase()) {
        _setStatus(PushNotificationsStatus.unavailable);
        return;
      }
      _messaging = FirebaseMessaging.instance;
      if (!await _messaging!.isSupported()) {
        _messaging = null;
        _setStatus(PushNotificationsStatus.unavailable);
        return;
      }
      final permission = await _messaging!.getNotificationSettings();
      if (_isGranted(permission.authorizationStatus)) {
        _permissionGranted = true;
        await _activateMessaging();
        _setStatus(PushNotificationsStatus.enabled);
        return;
      }
      _setStatus(
        permission.authorizationStatus == AuthorizationStatus.denied
            ? PushNotificationsStatus.denied
            : PushNotificationsStatus.notRequested,
      );
    } catch (error) {
      // Firebase ещё не настроен либо браузер не поддерживает push. Это не
      // должно мешать просмотру меню и оформлению заказа.
      debugPrint('FCM отключён: $error');
      _setStatus(PushNotificationsStatus.error, error: error);
    }
  }

  /// Должен вызываться напрямую из обработчика нажатия: Safari блокирует
  /// системный запрос разрешения, если он запущен автоматически при старте.
  Future<bool> requestPermission() async {
    if (_messaging == null) await initialize();
    final messaging = _messaging;
    if (messaging == null) {
      _setStatus(PushNotificationsStatus.unavailable);
      return false;
    }

    _setStatus(PushNotificationsStatus.requesting);
    try {
      final permission = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (!_isGranted(permission.authorizationStatus)) {
        _setStatus(
          permission.authorizationStatus == AuthorizationStatus.denied
              ? PushNotificationsStatus.denied
              : PushNotificationsStatus.notRequested,
        );
        return false;
      }

      _permissionGranted = true;
      await _activateMessaging();
      _setStatus(PushNotificationsStatus.enabled);
      return true;
    } catch (error) {
      debugPrint('Не удалось запросить разрешение FCM: $error');
      _setStatus(PushNotificationsStatus.error, error: error);
      return false;
    }
  }

  Future<void> _activateMessaging() async {
    final messaging = _messaging!;
    await messaging.setAutoInitEnabled(true);
    if (!_listenersAttached) {
      _listenersAttached = true;
      _foregroundMessages = FirebaseMessaging.onMessage.listen((message) {
        final title = message.notification?.title ?? 'PizzBurg';
        final body = message.notification?.body ?? '';
        onForegroundMessage?.call(title, body);
      });
      _openedMessages = FirebaseMessaging.onMessageOpenedApp.listen(
        (message) => onNotificationOpened?.call(message.data),
      );
      final initial = await messaging.getInitialMessage();
      if (initial != null) onNotificationOpened?.call(initial.data);

      _tokenRefresh = messaging.onTokenRefresh.listen((token) async {
        _token = token;
        await syncAfterLogin();
      });
    }
    _token = await messaging.getToken(
      vapidKey: kIsWeb && _webVapidKey.isNotEmpty ? _webVapidKey : null,
    );
    await syncAfterLogin();
  }

  Future<void> syncAfterLogin() async {
    if (!_permissionGranted) return;
    if (_token == null && _messaging != null) {
      try {
        _token = await _messaging!.getToken(
          vapidKey: kIsWeb && _webVapidKey.isNotEmpty ? _webVapidKey : null,
        );
      } catch (error) {
        debugPrint('Не удалось получить FCM-токен: $error');
      }
    }
    final token = _token;
    if (token == null || api.token == null) return;
    try {
      await api.registerPushToken(token, platform: _platform);
    } catch (error) {
      debugPrint('Не удалось зарегистрировать FCM-токен: $error');
    }
  }

  Future<void> unregisterBeforeLogout() async {
    final token = _token;
    if (token != null && api.token != null) {
      try {
        await api.unregisterPushToken(token, platform: _platform);
      } catch (error) {
        // Удаление локального токена ниже сделает сохранённый на backend
        // токен недействительным даже при недоступной сети.
        debugPrint('Не удалось отключить FCM-токен: $error');
      }
    }
    try {
      await _messaging?.deleteToken();
      _token = null;
    } catch (error) {
      debugPrint('Не удалось удалить локальный FCM-токен: $error');
    }
  }

  Future<bool> _initializeFirebase() async {
    if (Firebase.apps.isNotEmpty) return true;
    final hasRuntimeOptions =
        _apiKey.isNotEmpty &&
        _appId.isNotEmpty &&
        _messagingSenderId.isNotEmpty &&
        _projectId.isNotEmpty;
    if (hasRuntimeOptions) {
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: _apiKey,
          appId: _appId,
          messagingSenderId: _messagingSenderId,
          projectId: _projectId,
          authDomain: _authDomain.isEmpty ? null : _authDomain,
          storageBucket: _storageBucket.isEmpty ? null : _storageBucket,
          iosBundleId: kIsWeb ? null : _iosBundleId,
        ),
      );
      return true;
    }
    if (kIsWeb) {
      debugPrint('FCM web: Firebase dart-define параметры не заданы');
      return false;
    }
    // На iOS/Android параметры прочитаются из GoogleService-Info.plist или
    // google-services.json после их добавления владельцем Firebase-проекта.
    await Firebase.initializeApp();
    return true;
  }

  bool _isGranted(AuthorizationStatus status) {
    return status == AuthorizationStatus.authorized ||
        status == AuthorizationStatus.provisional;
  }

  void _setStatus(PushNotificationsStatus value, {Object? error}) {
    _status = value;
    _lastError = error?.toString();
    notifyListeners();
  }

  String get _platform {
    if (kIsWeb) return 'WEB';
    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'IOS',
      TargetPlatform.android => 'ANDROID',
      _ => 'UNKNOWN',
    };
  }

  @override
  void dispose() {
    unawaited(_tokenRefresh?.cancel());
    unawaited(_foregroundMessages?.cancel());
    unawaited(_openedMessages?.cancel());
    super.dispose();
  }
}
