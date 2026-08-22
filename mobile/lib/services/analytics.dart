import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';

/// Поведенческие события (DECISIONS §12.24).
///
/// Заказы отвечают, что купили. Эти события — что смотрели и не купили,
/// а это разные вопросы, и второй решает, что убрать из меню и работают
/// ли допродажи. Задним числом их не восстановить.
///
/// Копим в памяти и отправляем пачкой: событие на каждый тап означало бы
/// запрос на каждый тап, а меню листают быстро. Потеря пачки при
/// вылете приложения допустима — это статистика, а не деньги.
class Analytics {
  static const _deviceKey = 'pizzburg_device_id';
  static const _flushEvery = Duration(seconds: 20);
  static const _maxBuffer = 50;

  final ApiClient _api;
  final List<Map<String, dynamic>> _buffer = [];
  Timer? _timer;
  String? _deviceId;

  Analytics(this._api);

  /// Идентификатор устройства: гость смотрит меню, не входя, и его
  /// поведение тоже нужно видеть. Ничего личного в нём нет — случайная
  /// строка, живущая до переустановки.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_deviceKey);
    if (id == null) {
      final rnd = Random.secure();
      id = List.generate(16, (_) => rnd.nextInt(16).toRadixString(16)).join();
      await prefs.setString(_deviceKey, id);
    }
    _deviceId = id;
    _timer ??= Timer.periodic(_flushEvery, (_) => flush());
  }

  void log(String type, [Map<String, dynamic>? payload]) {
    _buffer.add({'type': type, 'payload': ?payload});
    // Переполнение отправляем сразу: держать бесконечный список в памяти
    // ради статистики — плохая сделка
    if (_buffer.length >= _maxBuffer) unawaited(flush());
  }

  /// Отправить накопленное. Ошибку глотаем: аналитика не должна мешать
  /// человеку заказывать еду.
  Future<void> flush() async {
    if (_buffer.isEmpty) return;
    final batch = List<Map<String, dynamic>>.from(_buffer);
    _buffer.clear();
    try {
      await _api.sendEvents(batch, deviceId: _deviceId);
    } catch (e) {
      debugPrint('Аналитика не отправлена: $e');
    }
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}

/// Имена событий держим в одном месте: опечатка в строке теряет половину
/// данных, и заметить это можно только через месяц, в отчёте.
abstract final class Ev {
  static const appOpen = 'app_open';
  static const search = 'search';
  static const productView = 'product_view';
  static const upsellShown = 'upsell_shown';
  static const upsellAdded = 'upsell_added';
  static const checkoutOpen = 'checkout_open';
}
