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
  int get cashbackPct =>
      (_profile?['loyalty']?['cashbackPct'] as num?)?.toInt() ?? 3;
  String get phone => customer?['phone']?.toString() ?? '';
  String get name => customer?['name']?.toString() ?? '';
  List<dynamic> get transactions =>
      (_profile?['loyaltyTransactions'] as List?) ?? const [];
  List<dynamic> get orders => (_profile?['orders'] as List?) ?? const [];

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

  Future<void> logout() async {
    await beforeLogout?.call();
    api.token = null;
    _profile = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    notifyListeners();
  }
}
