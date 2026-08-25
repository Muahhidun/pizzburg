import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';

class AuthState extends ChangeNotifier {
  static const _tokenKey = 'pizzburg_customer_token';
  final ApiClient api;
  Map<String, dynamic>? _profile;
  Future<void> Function()? afterLogin;
  Future<void> Function()? beforeLogout;

  AuthState(this.api);

  bool get isAuthenticated =>
      api.token != null && _profile?['customer'] != null;
  Map<String, dynamic>? get customer => _profile?['customer'];
  int get pointsBalance => (customer?['pointsBalance'] as num?)?.toInt() ?? 0;
  Map<String, dynamic> get _loyalty =>
      (_profile?['loyalty'] as Map?)?.cast<String, dynamic>() ?? const {};

  int get cashbackPct => (_loyalty['cashbackPct'] as num?)?.toInt() ?? 3;
  int get loyaltyLevel => (_loyalty['level'] as num?)?.toInt() ?? 1;
  String get levelName => _loyalty['levelName']?.toString() ?? '';
  int get levelsTotal => (_loyalty['levelsTotal'] as num?)?.toInt() ?? 1;

  /// Сколько ₸ оборота осталось до следующего уровня; 0 — уровень последний
  int get toNextLevel => (_loyalty['toNextLevel'] as num?)?.toInt() ?? 0;
  int? get nextCashbackPct => (_loyalty['nextCashbackPct'] as num?)?.toInt();
  String get phone => customer?['phone']?.toString() ?? '';
  String get name => customer?['name']?.toString() ?? '';
  List<dynamic> get transactions =>
      (_profile?['loyaltyTransactions'] as List?) ?? const [];
  List<dynamic> get orders => (_profile?['orders'] as List?) ?? const [];

  /// Типы документов, которых клиент ещё не принял. Список считает сервер:
  /// приложение не должно само сравнивать номера версий, иначе новая
  /// редакция оферты тихо разойдётся со старой сборкой.
  List<String> get pendingLegal =>
      ((_profile?['legal']?['pending'] as List?) ?? const [])
          .map((d) => d['type']?.toString() ?? '')
          .where((t) => t.isNotEmpty)
          .toList();

  bool get needsLegalConsent => isAuthenticated && pendingLegal.isNotEmpty;

  Future<void> acceptLegal() async {
    await api.acceptLegal();
    await refresh();
  }

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    if (token == null) return;
    api.token = token;
    try {
      await refresh();
    } catch (_) {
      await logout();
    }
  }

  Future<Map<String, dynamic>> requestOtp(String phone) =>
      api.requestOtp(phone);

  Future<void> verifyOtp(String phone, String code) async {
    final result = await api.verifyOtp(phone, code);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, result['token'].toString());
    api.token = result['token'].toString();
    await refresh();
    await afterLogin?.call();
  }

  Future<void> refresh() async {
    _profile = await api.me();
    notifyListeners();
  }

  /// Удалить аккаунт и выйти.
  ///
  /// Сервер может отказать, пока есть заказ в работе, — тогда исключение
  /// уходит наверх и экран покажет причину. Локальное состояние чистим
  /// только после успеха, иначе человек окажется разлогинен с живым
  /// аккаунтом и решит, что удаление прошло.
  Future<void> deleteAccount() async {
    await api.deleteAccount();
    await logout();
  }

  Future<void> logout() async {
    await beforeLogout?.call();
    api.token = null;
    _profile = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    notifyListeners();
  }
}
