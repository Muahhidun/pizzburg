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
    );
  }
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

String formatTenge(int value) {
  final s = value.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) buf.write(' ');
    buf.write(s[i]);
  }
  return '${buf.toString()} ₸';
}
