import 'dart:convert';
import 'package:http/http.dart' as http;
import 'models.dart';

/// Клиент нашего API.
///
/// Базовый URL задаётся при сборке:
///   flutter run -d chrome --dart-define=API_URL=http://localhost:3210
/// Для запуска на реальном iPhone указывайте IP Mac в локальной сети:
///   --dart-define=API_URL=http://192.168.0.10:3210
class ApiClient {
  static const baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:3210',
  );
  static const tenant = String.fromEnvironment(
    'TENANT',
    defaultValue: 'pizzburg',
  );

  String? token;

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (token != null) 'Authorization': 'Bearer $token',
  };

  Future<MenuResponse> fetchMenu() async {
    final res = await http.get(Uri.parse('$baseUrl/menu/$tenant'));
    _ensureOk(res);
    return MenuResponse.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  Future<CartPreview> previewCart(
    List<Map<String, dynamic>> items, {
    String? promoCode,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/cart/$tenant/preview'),
      headers: _headers,
      body: jsonEncode({
        'items': items,
        if (promoCode != null && promoCode.isNotEmpty) 'promoCode': promoCode,
      }),
    );
    _ensureOk(res);
    return CartPreview.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  Future<CreatedOrder> createOrder(Map<String, dynamic> order) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/$tenant'),
      headers: _headers,
      body: jsonEncode(order),
    );
    _ensureOk(res);
    return CreatedOrder.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  /// Режим приёма заказов, расписание и окно отмены.
  /// Экрану заказа нужен `cancelWindowMinutes`, а он приходит только сюда.
  Future<Availability> fetchAvailability() async {
    final res = await http.get(
      Uri.parse('$baseUrl/menu/$tenant/availability'),
    );
    _ensureOk(res);
    return Availability.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  /// Слоты предзаказа для выбранного способа получения
  Future<List<PreorderSlot>> preorderSlots(String type) async {
    final res = await http.get(
      Uri.parse('$baseUrl/menu/$tenant/preorder-slots?type=$type'),
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return ((data['slots'] ?? []) as List)
        .map((s) => PreorderSlot.fromJson(s))
        .toList();
  }

  /// Отмена заказа клиентом в отведённое окно.
  ///
  /// `reasonId` — причина из справочника; без неё отчёт по отменам не
  /// построить, поэтому свободный текст остаётся лишь дополнением.
  Future<void> cancelOrder(
    String orderId, {
    String? reasonId,
    String? reason,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/cancel'),
      headers: _headers,
      body: jsonEncode({
        'reasonId': ?reasonId,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      }),
    );
    _ensureOk(res);
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/$tenant/request-otp'),
      headers: _headers,
      body: jsonEncode({'phone': phone}),
    );
    _ensureOk(res);
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/$tenant/verify'),
      headers: _headers,
      body: jsonEncode({'phone': phone, 'code': code}),
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    token = data['token']?.toString();
    return data;
  }

  /// Действующие редакции документов. Нужны и экрану согласия, и профилю:
  /// Apple с Google требуют работающую ссылку на политику из приложения.
  Future<List<LegalDocument>> fetchLegalDocuments() async {
    final res = await http.get(Uri.parse('$baseUrl/legal/$tenant'));
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return ((data['documents'] ?? []) as List)
        .map((d) => LegalDocument.fromJson(d))
        .toList();
  }

  Future<LegalDocument> fetchLegalDocument(String type) async {
    final res = await http.get(Uri.parse('$baseUrl/legal/$tenant/$type'));
    _ensureOk(res);
    return LegalDocument.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  /// Клиент принял действующие редакции. Версии проставляет сервер.
  Future<void> acceptLegal() async {
    final res = await http.post(
      Uri.parse('$baseUrl/legal/$tenant/accept'),
      headers: _headers,
    );
    _ensureOk(res);
  }

  /// Причины отмены, которые разрешено показывать клиенту
  Future<List<CancelReason>> fetchCancelReasons() async {
    final res = await http.get(
      Uri.parse('$baseUrl/orders/$tenant/cancel-reasons'),
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as List;
    return data.map((r) => CancelReason.fromJson(r)).toList();
  }

  Future<Map<String, dynamic>> me() async {
    final res = await http.get(
      Uri.parse('$baseUrl/auth/me'),
      headers: _headers,
    );
    _ensureOk(res);
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<void> registerPushToken(
    String pushToken, {
    required String platform,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/push-token'),
      headers: _headers,
      body: jsonEncode({'token': pushToken, 'platform': platform}),
    );
    _ensureOk(res);
  }

  Future<void> unregisterPushToken(
    String pushToken, {
    required String platform,
  }) async {
    final res = await http.delete(
      Uri.parse('$baseUrl/auth/push-token'),
      headers: _headers,
      body: jsonEncode({'token': pushToken, 'platform': platform}),
    );
    _ensureOk(res);
  }

  Future<Map<String, dynamic>> orderStatus(String orderId) async {
    final res = await http.get(Uri.parse('$baseUrl/orders/by-id/$orderId'));
    _ensureOk(res);
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  void _ensureOk(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) return;
    String message = 'Ошибка ${res.statusCode}';
    try {
      final body = jsonDecode(utf8.decode(res.bodyBytes));
      if (body is Map && body['message'] != null) {
        message = body['message'] is List
            ? (body['message'] as List).join(', ')
            : body['message'].toString();
      }
    } catch (_) {}
    throw ApiException(message);
  }
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}
