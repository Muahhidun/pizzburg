import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../api/api_client.dart';

/// Что сервер говорит приложению о нём самом.
///
/// Главное — минимальная версия. Ниже неё приложение закрывается экраном
/// «Обновите приложение»: иначе старую версию нельзя заставить обновиться
/// ни к Рамадану, ни после изменения оплаты. Проверяем при запуске и при
/// каждом возврате из фона: приложение месяцами живёт в памяти, и
/// «при запуске» случается редко.
///
/// Нет сети или сервер не ответил — ничего не блокируем: закрыть
/// приложение из-за сбоя связи хуже, чем пропустить одну проверку.
class AppConfig extends ChangeNotifier {
  final ApiClient api;
  AppConfig(this.api);

  String? _version;
  String? get version => _version;

  bool _updateRequired = false;
  bool get updateRequired => _updateRequired;

  String? _storeUrl;
  String? get storeUrl => _storeUrl;

  int _unpaidCancelMinutes = 30;
  int get unpaidCancelMinutes => _unpaidCancelMinutes;

  /// Подарок за вход в приложение; null — акции нет
  WelcomeBonus? _welcomeBonus;
  WelcomeBonus? get welcomeBonus => _welcomeBonus;

  /// Какие баннеры о приложении показывать на сайте. До ответа сервера —
  /// никакие: окно не должно мелькнуть и пропасть.
  WebPromo _webPromo = const WebPromo(popup: false, bar: false, qr: false);
  WebPromo get webPromo => _webPromo;

  /// Для экранов без доступа к Provider (тексты в getter'ах)
  static AppConfig? instance;

  Future<void> refresh() async {
    instance = this;
    try {
      _version ??= (await PackageInfo.fromPlatform()).version;
      final c = await api.fetchAppConfig();
      final platform = defaultTargetPlatform == TargetPlatform.iOS
          ? 'ios'
          : 'android';
      final min = (c['minVersion'] as Map?)?[platform]?.toString();
      _storeUrl = (c['store'] as Map?)?[platform]?.toString();
      _unpaidCancelMinutes =
          (c['unpaidCancelMinutes'] as num?)?.toInt() ?? _unpaidCancelMinutes;
      _welcomeBonus = WelcomeBonus.fromJson(c['welcomeBonus']);
      // Старый сервер без поля — баннеры включены, как по умолчанию
      _webPromo = WebPromo.fromJson(c['webPromo']);
      final required =
          !kIsWeb &&
          min != null &&
          isOlder(_version!, min) &&
          _storeUrl != null;
      if (required != _updateRequired) {
        _updateRequired = required;
      }
      notifyListeners();
    } catch (e) {
      debugPrint('Настройки приложения не получены: $e');
    }
  }
}

/// `a` старше `b`: 1.0.0 < 1.0.1 < 1.1.0 < 2.0.0
@visibleForTesting
bool isOlder(String a, String b) {
  List<int> parts(String v) =>
      v.split('+').first.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  final x = parts(a), y = parts(b);
  for (var i = 0; i < 3; i++) {
    final l = i < x.length ? x[i] : 0;
    final r = i < y.length ? y[i] : 0;
    if (l != r) return l < r;
  }
  return false;
}

/// Подарок за вход: сколько, до какого дня получить и до какого потратить
class WelcomeBonus {
  final int amount;
  final DateTime? until;
  final DateTime? spendUntil;
  const WelcomeBonus({required this.amount, this.until, this.spendUntil});

  static WelcomeBonus? fromJson(Object? json) {
    if (json is! Map) return null;
    final amount = (json['amount'] as num?)?.toInt() ?? 0;
    if (amount <= 0) return null;
    DateTime? day(Object? v) => v is String ? DateTime.tryParse(v) : null;
    return WelcomeBonus(
      amount: amount,
      until: day(json['until']),
      spendUntil: day(json['spendUntil']),
    );
  }
}

class WebPromo {
  final bool popup;
  final bool bar;
  final bool qr;
  const WebPromo({required this.popup, required this.bar, required this.qr});

  factory WebPromo.fromJson(Object? json) {
    final m = json is Map ? json : const {};
    bool on(String k) => m[k] != false;
    return WebPromo(popup: on('popup'), bar: on('bar'), qr: on('qr'));
  }
}
