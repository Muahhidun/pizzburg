// Модели данных приложения. Зеркалят ответы нашего API.

class MenuResponse {
  final String tenantName;
  final List<MenuCategory> categories;

  MenuResponse({required this.tenantName, required this.categories});

  factory MenuResponse.fromJson(Map<String, dynamic> json) => MenuResponse(
    tenantName: json['tenant']?['name'] ?? '',
    categories: (json['categories'] as List)
        .map((c) => MenuCategory.fromJson(c))
        .toList(),
  );
}

class MenuCategory {
  final String id;
  final String name;
  final List<Product> products;

  MenuCategory({required this.id, required this.name, required this.products});

  factory MenuCategory.fromJson(Map<String, dynamic> json) => MenuCategory(
    id: json['id'],
    name: json['name'],
    products: (json['products'] as List)
        .map((p) => Product.fromJson(p))
        .toList(),
  );
}

class Product {
  final String id;
  final String name;
  final String description;
  final String? photoUrl;
  final String weightLabel;
  final bool isHit;
  final bool isSpicy;
  final bool isNew;
  final int price;
  final List<ModifierGroup> modifierGroups;

  /// Позиция временно снята с продажи (DECISIONS §12.3).
  ///
  /// Из каталога она при этом не исчезает: исчезновение постоянный клиент
  /// читает как «блюда больше нет в меню». Показываем её приглушённой с
  /// подписью и не даём положить в корзину.
  final bool isAvailable;

  Product({
    required this.id,
    required this.name,
    required this.description,
    this.photoUrl,
    this.weightLabel = '',
    this.isHit = false,
    this.isSpicy = false,
    this.isNew = false,
    required this.price,
    required this.modifierGroups,
    this.isAvailable = true,
  });

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'],
    name: json['name'],
    description: json['description'] ?? '',
    photoUrl: json['photoUrl'],
    weightLabel: json['weightLabel'] ?? '',
    isHit: json['isHit'] ?? false,
    isSpicy: json['isSpicy'] ?? false,
    isNew: json['isNew'] ?? false,
    price: json['price'],
    modifierGroups: ((json['modifierGroups'] ?? []) as List)
        .map((g) => ModifierGroup.fromJson(g))
        .toList(),
    // Старые сборки поля не знают: без него позиция считается доступной,
    // и сервер всё равно не даст оформить заказ
    isAvailable: json['isAvailable'] ?? true,
  );

  bool get hasChoices => modifierGroups.isNotEmpty;
}

/// Набор модификаторов из тех.карты Poster («Напиток к сету», «Фри»)
class ModifierGroup {
  final String id;
  final String name;
  final int min;
  final int max;
  final List<ModifierOption> options;

  ModifierGroup({
    required this.id,
    required this.name,
    required this.min,
    required this.max,
    required this.options,
  });

  factory ModifierGroup.fromJson(Map<String, dynamic> json) => ModifierGroup(
    id: json['id'],
    name: json['name'],
    min: json['min'] ?? 0,
    max: json['max'] ?? 1,
    options: (json['options'] as List)
        .map((o) => ModifierOption.fromJson(o))
        .toList(),
  );
}

class ModifierOption {
  final String id;
  final String name;
  final int price;

  ModifierOption({required this.id, required this.name, required this.price});

  factory ModifierOption.fromJson(Map<String, dynamic> json) => ModifierOption(
    id: json['id'],
    name: json['name'],
    price: json['price'] ?? 0,
  );
}

/// Ответ /cart/preview — суммы и подарки по акциям
class CartPreview {
  final int subtotal;
  final int promoDiscount;
  final List<CartGift> gifts;
  final List<String> appliedPromotions;
  final int deliveryFee;
  final int minOrder;
  final int? freeFrom;
  final bool deliveryAvailable;
  final int cashbackPct;
  final bool earnWhenPointsSpent;
  final bool allowPointsWithPromotions;
  final bool earnOnPromotionalOrders;
  final Availability availability;

  /// «Добавьте ещё на N ₸ — подарок». Порог считает сервер.
  final NextGift? nextGift;

  CartPreview({
    required this.subtotal,
    required this.promoDiscount,
    required this.gifts,
    required this.appliedPromotions,
    required this.deliveryFee,
    required this.minOrder,
    this.freeFrom,
    required this.deliveryAvailable,
    required this.cashbackPct,
    required this.earnWhenPointsSpent,
    required this.allowPointsWithPromotions,
    required this.earnOnPromotionalOrders,
    required this.availability,
    this.nextGift,
  });

  factory CartPreview.fromJson(Map<String, dynamic> json) {
    final d = json['delivery'] ?? {};
    return CartPreview(
      subtotal: json['subtotal'] ?? 0,
      promoDiscount: json['promoDiscount'] ?? 0,
      gifts: ((json['gifts'] ?? []) as List)
          .map((g) => CartGift.fromJson(g))
          .toList(),
      appliedPromotions: ((json['appliedPromotions'] ?? []) as List)
          .cast<String>(),
      deliveryFee: d['fee'] ?? 0,
      minOrder: d['minOrder'] ?? 0,
      freeFrom: d['freeFrom'],
      deliveryAvailable: d['available'] ?? true,
      cashbackPct: json['loyalty']?['cashbackPct'] ?? 3,
      earnWhenPointsSpent: json['loyalty']?['earnWhenPointsSpent'] == true,
      allowPointsWithPromotions:
          json['loyalty']?['allowPointsWithPromotions'] == true,
      earnOnPromotionalOrders:
          json['loyalty']?['earnOnPromotionalOrders'] == true,
      availability: Availability.fromJson(json['availability']),
      nextGift: json['nextGift'] == null
          ? null
          : NextGift.fromJson(json['nextGift']),
    );
  }
}

/// Ближайшая невыполненная акция на сумму
class NextGift {
  final String giftName;
  final int missing;

  const NextGift({required this.giftName, required this.missing});

  factory NextGift.fromJson(Map<String, dynamic> json) => NextGift(
    giftName: json['giftName']?.toString() ?? '',
    missing: (json['missing'] as num?)?.toInt() ?? 0,
  );
}

/// Режим приёма заказов: что сейчас можно предложить клиенту.
/// Считает сервер — приложение только показывает.
class Availability {
  final String mode; // ALL | PICKUP_ONLY | CLOSED
  final bool isOpenNow;
  final bool deliveryAvailable;
  final bool pickupAvailable;
  final bool asapAvailable;
  final String? message;
  final bool preorderEnabled;
  final List<List<String>> todayHours;
  final bool cashEnabled;
  final bool cardOnDeliveryEnabled;
  final bool kaspiOnlineEnabled;
  final bool askChangeFrom;
  final int cancelWindowMinutes;

  const Availability({
    required this.mode,
    required this.isOpenNow,
    required this.deliveryAvailable,
    required this.pickupAvailable,
    required this.asapAvailable,
    this.message,
    required this.preorderEnabled,
    required this.todayHours,
    required this.cashEnabled,
    required this.cardOnDeliveryEnabled,
    required this.kaspiOnlineEnabled,
    required this.askChangeFrom,
    required this.cancelWindowMinutes,
  });

  /// Отсутствие блока в ответе не должно ломать приложение:
  /// считаем, что всё доступно, а сервер всё равно перепроверит.
  factory Availability.fromJson(Map<String, dynamic>? json) {
    final j = json ?? const <String, dynamic>{};
    final payments = (j['payments'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    return Availability(
      mode: j['mode'] ?? 'ALL',
      isOpenNow: j['isOpenNow'] ?? true,
      deliveryAvailable: j['deliveryAvailable'] ?? true,
      pickupAvailable: j['pickupAvailable'] ?? true,
      asapAvailable: j['asapAvailable'] ?? true,
      message: j['message'],
      preorderEnabled: j['preorderEnabled'] ?? true,
      todayHours: ((j['todayHours'] ?? const []) as List)
          .map<List<String>>((i) => (i as List).cast<String>())
          .toList(),
      cashEnabled: payments['cash'] ?? true,
      cardOnDeliveryEnabled: payments['cardOnDelivery'] ?? true,
      kaspiOnlineEnabled: payments['kaspiOnline'] ?? false,
      askChangeFrom: payments['askChangeFrom'] ?? true,
      cancelWindowMinutes: j['cancelWindowMinutes'] ?? 0,
    );
  }
}

/// Слот предзаказа из /menu/:slug/preorder-slots
class PreorderSlot {
  final DateTime at;
  final String label;

  const PreorderSlot({required this.at, required this.label});

  factory PreorderSlot.fromJson(Map<String, dynamic> json) => PreorderSlot(
    at: DateTime.parse(json['at']),
    label: json['label'] ?? '',
  );
}

class CartGift {
  final String name;
  final int qty;
  final int fullPrice;
  final String promotion;

  CartGift({
    required this.name,
    required this.qty,
    required this.fullPrice,
    required this.promotion,
  });

  factory CartGift.fromJson(Map<String, dynamic> json) => CartGift(
    name: json['name'],
    qty: json['qty'],
    fullPrice: json['fullPrice'] ?? 0,
    promotion: json['promotion'] ?? '',
  );
}

class CreatedOrder {
  final String id;
  final int number;
  final int total;
  final int pointsSpent;

  CreatedOrder({
    required this.id,
    required this.number,
    required this.total,
    required this.pointsSpent,
  });

  factory CreatedOrder.fromJson(Map<String, dynamic> json) => CreatedOrder(
    id: json['id'],
    number: json['number'],
    total: json['total'],
    pointsSpent: json['pointsSpent'] ?? 0,
  );
}

/// Прошлый заказ для блока повтора на главном экране.
class LastOrder {
  final String id;
  final int number;
  final int total;
  final int positions;

  /// Состав одной строкой: «Маргарита, Комбо Хот-Дог»
  final String summary;
  final String? photoUrl;

  const LastOrder({
    required this.id,
    required this.number,
    required this.total,
    required this.positions,
    required this.summary,
    this.photoUrl,
  });

  factory LastOrder.fromJson(Map<String, dynamic> json) => LastOrder(
    id: json['id']?.toString() ?? '',
    number: (json['number'] as num?)?.toInt() ?? 0,
    total: (json['total'] as num?)?.toInt() ?? 0,
    positions: (json['positions'] as num?)?.toInt() ?? 0,
    summary: json['summary']?.toString() ?? '',
    photoUrl: json['photoUrl']?.toString(),
  );
}

/// Что удалось перенести из прошлого заказа, а что — нет.
class RepeatResult {
  final List<RepeatItem> items;
  final List<RepeatMissing> unavailable;

  const RepeatResult({required this.items, required this.unavailable});

  factory RepeatResult.fromJson(Map<String, dynamic> json) => RepeatResult(
    items: ((json['items'] ?? []) as List)
        .map((i) => RepeatItem.fromJson(i))
        .toList(),
    unavailable: ((json['unavailable'] ?? []) as List)
        .map((u) => RepeatMissing.fromJson(u))
        .toList(),
  );
}

class RepeatItem {
  final String productId;
  final int qty;

  /// Идентификаторы модификаторов Poster из прошлого заказа
  final List<String> modifierIds;

  const RepeatItem({
    required this.productId,
    required this.qty,
    this.modifierIds = const [],
  });

  factory RepeatItem.fromJson(Map<String, dynamic> json) => RepeatItem(
    productId: json['productId']?.toString() ?? '',
    qty: (json['qty'] as num?)?.toInt() ?? 1,
    modifierIds: ((json['modifiers'] ?? []) as List)
        .map((m) => (m as Map)['posterId']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toList(),
  );
}

class RepeatMissing {
  final String name;
  final String reason;

  const RepeatMissing({required this.name, required this.reason});

  factory RepeatMissing.fromJson(Map<String, dynamic> json) => RepeatMissing(
    name: json['name']?.toString() ?? '',
    reason: json['reason']?.toString() ?? '',
  );
}

/// Товар в избранном. Цена и стоп-лист — актуальные, а не на момент
/// добавления: иначе человек увидит цену прошлого месяца.
class FavoriteProduct {
  final String id;
  final String name;
  final String description;
  final String? photoUrl;
  final String weightLabel;
  final int price;
  final bool inStopList;

  const FavoriteProduct({
    required this.id,
    required this.name,
    required this.description,
    this.photoUrl,
    this.weightLabel = '',
    required this.price,
    this.inStopList = false,
  });

  factory FavoriteProduct.fromJson(Map<String, dynamic> json) =>
      FavoriteProduct(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        description: json['description']?.toString() ?? '',
        photoUrl: json['photoUrl']?.toString(),
        weightLabel: json['weightLabel']?.toString() ?? '',
        price: (json['price'] as num?)?.toInt() ?? 0,
        inStopList: json['inStopList'] == true,
      );

  /// Для повторного использования строки каталога
  Product toProduct() => Product(
    id: id,
    name: name,
    description: description,
    photoUrl: photoUrl,
    weightLabel: weightLabel,
    price: price,
    modifierGroups: const [],
  );
}

/// Сообщение ленты: акция, новость, объявление заведения
class FeedMessage {
  final String id;
  final String title;
  final String body;
  final String? imageUrl;
  final DateTime createdAt;

  const FeedMessage({
    required this.id,
    required this.title,
    required this.body,
    this.imageUrl,
    required this.createdAt,
  });

  factory FeedMessage.fromJson(Map<String, dynamic> json) => FeedMessage(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '',
    body: json['body']?.toString() ?? '',
    imageUrl: json['imageUrl']?.toString(),
    createdAt:
        DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
        DateTime.now(),
  );
}

/// Подсказка адреса из 2ГИС
class AddressSuggestion {
  final String label;
  final String street;
  final String house;

  const AddressSuggestion({
    required this.label,
    required this.street,
    required this.house,
  });

  factory AddressSuggestion.fromJson(Map<String, dynamic> json) =>
      AddressSuggestion(
        label: json['label']?.toString() ?? '',
        street: json['street']?.toString() ?? '',
        house: json['house']?.toString() ?? '',
      );
}

/// Сохранённый адрес клиента.
class SavedAddress {
  final String id;
  final String street;
  final String house;
  final String flat;
  final String entrance;
  final String floor;
  final String comment;
  final String label;

  const SavedAddress({
    required this.id,
    required this.street,
    required this.house,
    this.flat = '',
    this.entrance = '',
    this.floor = '',
    this.comment = '',
    this.label = '',
  });

  factory SavedAddress.fromJson(Map<String, dynamic> json) => SavedAddress(
    id: json['id']?.toString() ?? '',
    street: json['street']?.toString() ?? '',
    house: json['house']?.toString() ?? '',
    flat: json['flat']?.toString() ?? '',
    entrance: json['entrance']?.toString() ?? '',
    floor: json['floor']?.toString() ?? '',
    comment: json['comment']?.toString() ?? '',
    label: json['label']?.toString() ?? '',
  );

  /// Одна строка для списка выбора: «Абая 12, кв. 5, подъезд 2, этаж 3»
  String get oneLine {
    final parts = <String>[
      '$street, $house',
      if (flat.isNotEmpty) 'кв. $flat',
      if (entrance.isNotEmpty) 'подъезд $entrance',
      if (floor.isNotEmpty) 'этаж $floor',
    ];
    return parts.join(', ');
  }
}

/// Юридический документ в действующей редакции.
///
/// Номер версии носим с собой не для красоты: согласие хранится версией, и
/// при выпуске новой редакции оферты его нужно запросить заново.
class LegalDocument {
  final String type;
  final int version;
  final String title;
  final String content;

  const LegalDocument({
    required this.type,
    required this.version,
    required this.title,
    required this.content,
  });

  factory LegalDocument.fromJson(Map<String, dynamic> json) => LegalDocument(
    type: json['type']?.toString() ?? '',
    version: (json['version'] as num?)?.toInt() ?? 0,
    title: json['title']?.toString() ?? '',
    content: json['content']?.toString() ?? '',
  );

  /// Человеческое название для заголовков и ссылок
  String get displayTitle {
    if (title.isNotEmpty) return title;
    switch (type) {
      case 'OFFER':
        return 'Публичная оферта';
      case 'PRIVACY':
        return 'Политика конфиденциальности';
      case 'REQUISITES':
        return 'Реквизиты';
      default:
        return type;
    }
  }
}

/// Причина отмены из справочника. Свободный текст кассира невозможно
/// сгруппировать в отчёт, поэтому клиент выбирает из списка.
class CancelReason {
  final String id;
  final String label;

  const CancelReason({required this.id, required this.label});

  factory CancelReason.fromJson(Map<String, dynamic> json) => CancelReason(
    id: json['id']?.toString() ?? '',
    label: json['label']?.toString() ?? '',
  );
}

/// Деньги: целые тенге, разряды разделены НЕРАЗРЫВНЫМ пробелом.
///
/// Хендофф просит «тонкий пробел», но в Unbounded — а это шрифт всех сумм
/// и баланса — нет ни U+2009, ни U+202F: вместо разделителя получился бы
/// пустой квадрат в самом заметном тексте приложения. U+00A0 есть в обоих
/// шрифтах и вдобавок не даёт «5 050» переноситься между строк.
String formatTenge(int value, {bool withCurrency = true}) {
  final digits = value.abs().toString();
  final buffer = StringBuffer(value < 0 ? '\u2212' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('\u00A0');
    buffer.write(digits[i]);
  }
  return withCurrency ? '${buffer.toString()}\u00A0₸' : buffer.toString();
}
