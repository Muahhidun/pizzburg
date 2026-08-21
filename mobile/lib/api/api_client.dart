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

  /// Написать по живому заказу (DECISIONS §12.21).
  ///
  /// Без токена: заказ можно оформить гостем, и именно гость чаще всего
  /// пишет «не тот адрес». От спама защищает лимит на сервере.
  Future<void> sendOrderMessage(
    String orderId, {
    required String topic,
    String? text,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/message'),
      headers: _headers,
      body: jsonEncode({
        'topic': topic,
        if (text != null && text.trim().isNotEmpty) 'text': text.trim(),
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

  /// Последний заказ для блока «Тот же заказ?». null — заказов ещё не было.
  Future<LastOrder?> fetchLastOrder() async {
    final res = await http.get(
      Uri.parse('$baseUrl/orders/$tenant/last'),
      headers: _headers,
    );
    _ensureOk(res);
    final body = utf8.decode(res.bodyBytes).trim();
    if (body.isEmpty || body == 'null') return null;
    return LastOrder.fromJson(jsonDecode(body));
  }

  /// Пересобирает корзину из прошлого заказа по текущему меню и ценам.
  /// Возвращает и то, что перенеслось, и то, чего сегодня нет.
  Future<RepeatResult> repeatOrder(String orderId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/repeat'),
      headers: _headers,
    );
    _ensureOk(res);
    return RepeatResult.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
  }

  /// Сохранить адрес до оформления заказа.
  ///
  /// Раньше адрес появлялся только вместе с заказом — пополнить список с
  /// главного экрана было нечем.
  Future<void> saveAddress({
    required String street,
    required String house,
    String? flat,
    String? entrance,
    String? floor,
    String? comment,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/addresses'),
      headers: _headers,
      body: jsonEncode({
        'street': street,
        'house': house,
        if (flat != null && flat.isNotEmpty) 'flat': flat,
        if (entrance != null && entrance.isNotEmpty) 'entrance': entrance,
        if (floor != null && floor.isNotEmpty) 'floor': floor,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      }),
    );
    _ensureOk(res);
  }

  /// id избранных товаров — для сердечек в каталоге
  Future<List<String>> fetchFavoriteIds() async {
    final res = await http.get(
      Uri.parse('$baseUrl/favorites/ids'),
      headers: _headers,
    );
    _ensureOk(res);
    return (jsonDecode(utf8.decode(res.bodyBytes)) as List).cast<String>();
  }

  /// Избранное с актуальными ценой и стоп-листом
  Future<List<FavoriteProduct>> fetchFavorites() async {
    final res = await http.get(
      Uri.parse('$baseUrl/favorites'),
      headers: _headers,
    );
    _ensureOk(res);
    return (jsonDecode(utf8.decode(res.bodyBytes)) as List)
        .map((f) => FavoriteProduct.fromJson(f))
        .toList();
  }

  /// Сердечко — один переключатель: клиенту не нужно знать текущее
  /// состояние, чтобы его нажать. Возвращает новое состояние.
  Future<bool> toggleFavorite(String productId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/favorites/$productId/toggle'),
      headers: _headers,
    );
    _ensureOk(res);
    return jsonDecode(utf8.decode(res.bodyBytes))['favorite'] == true;
  }

  /// Подсказки адресов из 2ГИС через наш бэкенд.
  ///
  /// Ключ живёт на сервере, а не в сборке приложения, и город фиксируется
  /// там же — иначе в подсказках всплывают одноимённые улицы Павлодара.
  Future<List<AddressSuggestion>> suggestAddress(String query) async {
    final res = await http.get(
      Uri.parse('$baseUrl/geo/suggest?q=${Uri.encodeQueryComponent(query)}'),
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return ((data['items'] ?? []) as List)
        .map((i) => AddressSuggestion.fromJson(i))
        .toList();
  }

  /// Лента сообщений заведения — публичная, гости тоже видят
  Future<List<FeedMessage>> fetchMessages() async {
    final res = await http.get(Uri.parse('$baseUrl/messages/$tenant'));
    _ensureOk(res);
    return (jsonDecode(utf8.decode(res.bodyBytes)) as List)
        .map((m) => FeedMessage.fromJson(m))
        .toList();
  }

  /// Дома выбранной улицы. Второй шаг: сначала улица, потом номер —
  /// на улице Беркимбаева 217 домов, списком их не показать.
  Future<List<AddressSuggestion>> fetchHouses(String street, String q) async {
    final res = await http.get(
      Uri.parse(
        '$baseUrl/geo/houses?street=${Uri.encodeQueryComponent(street)}'
        '&q=${Uri.encodeQueryComponent(q)}',
      ),
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return ((data['items'] ?? []) as List)
        .map((i) => AddressSuggestion.fromJson(i))
        .toList();
  }

  /// «Моего адреса нет в списке».
  ///
  /// Заявка уходит оператору, а заказ при этом не блокируется: закрытый
  /// справочник рано или поздно не найдёт реальный дом реального человека,
  /// и упереться в это он должен не на этапе оплаты.
  Future<void> requestAddress(String raw, {String? phone}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/geo/address-request'),
      headers: _headers,
      body: jsonEncode({'raw': raw, 'phone': ?phone}),
    );
    _ensureOk(res);
  }

  /// Сохранённые адреса клиента, самый свежий сверху.
  /// Заводить их вручную не нужно — они накапливаются при оформлении.
  Future<List<SavedAddress>> fetchAddresses() async {
    final res = await http.get(
      Uri.parse('$baseUrl/auth/addresses'),
      headers: _headers,
    );
    _ensureOk(res);
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as List;
    return data.map((a) => SavedAddress.fromJson(a)).toList();
  }

  Future<void> deleteAddress(String id) async {
    final res = await http.delete(
      Uri.parse('$baseUrl/auth/addresses/$id'),
      headers: _headers,
    );
    _ensureOk(res);
  }

  Future<void> updateProfile({String? name, String? birthday}) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/auth/me'),
      headers: _headers,
      body: jsonEncode({'name': ?name, 'birthday': ?birthday}),
    );
    _ensureOk(res);
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

  /// Спрашивает Poster о статусе прямо сейчас.
  ///
  /// `orderStatus` читает только нашу базу, а её двигает фоновый опрос раз
  /// в минуту. Пока экран статуса открыт, ждать этот круг незачем — и, если
  /// опрос почему-то не отработал, экран не должен оставаться слепым.
  Future<void> syncOrderStatus(String orderId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/sync-status'),
    );
    _ensureOk(res);
  }

  /// Ответ на нехватку позиции: везём остальное (DECISIONS §12.9).
  ///
  /// Два метода вместо одного с флагом — по той же причине, по какой на
  /// сервере два эндпоинта: выбор необратим, и «везти» не должно стать
  /// «отменить» из-за перепутанного параметра.
  Future<void> keepOrderWithoutMissing(String orderId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/shortage/keep'),
      headers: _headers,
    );
    _ensureOk(res);
  }

  /// Ответ на нехватку позиции: отменить заказ целиком
  Future<void> cancelOrderForShortage(String orderId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/orders/by-id/$orderId/shortage/cancel'),
      headers: _headers,
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
