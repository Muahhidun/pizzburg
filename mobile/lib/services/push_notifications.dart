import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

/// Подключает FCM, регистрирует токен установки в нашем backend и передаёт
/// события интерфейсу. До добавления Firebase-конфигурации тихо отключается,
/// поэтому локальный web/staging продолжает запускаться.
class PushNotificationsService {
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

  void Function(String title, String body)? onForegroundMessage;
  void Function(Map<String, dynamic> data)? onNotificationOpened;

  PushNotificationsService(this.api);

  Future<void> initialize() async {
    try {
      if (!await _initializeFirebase()) return;
      _messaging = FirebaseMessaging.instance;
      final permission = await _messaging!.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (permission.authorizationStatus == AuthorizationStatus.denied) return;

      await _messaging!.setAutoInitEnabled(true);
      _foregroundMessages = FirebaseMessaging.onMessage.listen((message) {
        final title = message.notification?.title ?? 'PizzBurg';
        final body = message.notification?.body ?? '';
        onForegroundMessage?.call(title, body);
      });
      _openedMessages = FirebaseMessaging.onMessageOpenedApp.listen(
        (message) => onNotificationOpened?.call(message.data),
      );
      final initial = await _messaging!.getInitialMessage();
      if (initial != null) onNotificationOpened?.call(initial.data);

      _tokenRefresh = _messaging!.onTokenRefresh.listen((token) async {
        _token = token;
        await syncAfterLogin();
      });
      _token = await _messaging!.getToken(
        vapidKey: kIsWeb && _webVapidKey.isNotEmpty ? _webVapidKey : null,
      );
      await syncAfterLogin();
    } catch (error) {
      // Firebase ещё не настроен либо браузер не поддерживает push. Это не
      // должно мешать просмотру меню и оформлению заказа.
      debugPrint('FCM отключён: $error');
    }
  }

  Future<void> syncAfterLogin() async {
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

  String get _platform {
    if (kIsWeb) return 'WEB';
    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'IOS',
      TargetPlatform.android => 'ANDROID',
      _ => 'UNKNOWN',
    };
  }

  Future<void> dispose() async {
    await _tokenRefresh?.cancel();
    await _foregroundMessages?.cancel();
    await _openedMessages?.cancel();
  }
}
