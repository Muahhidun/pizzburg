import 'package:flutter/foundation.dart';
import '../api/models.dart';

/// Позиция корзины: товар + выбранные модификаторы.
/// Одинаковый товар с разным выбором — разные строки.
class CartLine {
  final Product product;
  final List<ModifierOption> modifiers;
  int qty;

  CartLine({required this.product, required this.modifiers, this.qty = 1});

  /// Ключ для схлопывания одинаковых позиций
  String get key =>
      '${product.id}|${(modifiers.map((m) => m.id).toList()..sort()).join(',')}';

  int get unitPrice =>
      product.price + modifiers.fold(0, (sum, m) => sum + m.price);

  int get total => unitPrice * qty;

  Map<String, dynamic> toApiJson() => {
        'productId': product.id,
        'qty': qty,
        if (modifiers.isNotEmpty)
          'modifiers': modifiers
              .map((m) => {'posterId': m.id, 'name': m.name, 'price': m.price})
              .toList(),
      };
}

class Cart extends ChangeNotifier {
  final List<CartLine> _lines = [];

  List<CartLine> get lines => List.unmodifiable(_lines);
  bool get isEmpty => _lines.isEmpty;
  int get count => _lines.fold(0, (sum, l) => sum + l.qty);
  int get subtotal => _lines.fold(0, (sum, l) => sum + l.total);

  void add(Product product, {List<ModifierOption> modifiers = const []}) {
    final line = CartLine(product: product, modifiers: modifiers);
    final existing = _lines.indexWhere((l) => l.key == line.key);
    if (existing >= 0) {
      _lines[existing].qty++;
    } else {
      _lines.add(line);
    }
    notifyListeners();
  }

  void increment(CartLine line) {
    line.qty++;
    notifyListeners();
  }

  void decrement(CartLine line) {
    line.qty--;
    if (line.qty <= 0) _lines.remove(line);
    notifyListeners();
  }

  void remove(CartLine line) {
    _lines.remove(line);
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    notifyListeners();
  }

  /// Сколько штук этого товара в корзине (для бейджа на карточке)
  int qtyOf(Product product) => _lines
      .where((l) => l.product.id == product.id)
      .fold(0, (sum, l) => sum + l.qty);

  List<Map<String, dynamic>> toApiItems() =>
      _lines.map((l) => l.toApiJson()).toList();
}
