import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
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

/// Последний оформленный заказ, запомненный на устройстве.
///
/// Гость не входит в профиль, значит `/auth/me` о его заказе не знает — и
/// после оформления вернуться к статусу было бы невозможно. Поэтому id
/// заказа сохраняется локально: главный экран показывает по нему активный
/// заказ, пока тот не завершится.
abstract final class LastPlacedOrder {
  static const _key = 'pizzburg_last_order';

  /// Меняется при каждом запоминании и забывании заказа.
  ///
  /// Каталог живёт в IndexedStack и данные запрашивает один раз при
  /// создании — после оформления он так и показывал блок «Повторить
  /// заказ», а нового заказа и вопроса по нему человек не видел вовсе.
  /// Через этот сигнал экран узнаёт, что смотреть надо заново.
  static final ValueNotifier<int> revision = ValueNotifier(0);

  static Future<void> remember(String id, int number, int total) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key, [id, '$number', '$total']);
    revision.value++;
  }

  static Future<(String id, int number, int total)?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getStringList(_key);
    if (raw == null || raw.length != 3) return null;
    return (raw[0], int.tryParse(raw[1]) ?? 0, int.tryParse(raw[2]) ?? 0);
  }

  static Future<void> forget() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
    revision.value++;
  }
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

  /// Наполняет корзину из повтора прошлого заказа.
  ///
  /// Товары и модификаторы берутся из **текущего** меню, а не из снимка
  /// заказа: цены могли измениться, и человек платит сегодняшнюю. Позиция,
  /// которой сегодня нет, просто не попадёт в корзину — о ней сервер
  /// сообщил отдельным списком, и её нужно показать, а не проглотить.
  ///
  /// Корзина перед наполнением очищается: «повторить» означает именно
  /// прошлый заказ, а не «дописать его к тому, что уже набрано».
  int fillFromRepeat(RepeatResult repeat, MenuResponse menu) {
    final products = <String, Product>{
      for (final category in menu.categories)
        for (final product in category.products) product.id: product,
    };

    _lines.clear();
    var added = 0;
    for (final item in repeat.items) {
      final product = products[item.productId];
      if (product == null) continue;

      // Модификаторы сопоставляем по id: набор в тех.карте мог поменяться,
      // и исчезнувшую добавку молча пропускаем.
      final options = <ModifierOption>[];
      for (final group in product.modifierGroups) {
        for (final option in group.options) {
          if (item.modifierIds.contains(option.id)) options.add(option);
        }
      }

      final line = CartLine(product: product, modifiers: options, qty: item.qty);
      final existing = _lines.indexWhere((l) => l.key == line.key);
      if (existing >= 0) {
        _lines[existing].qty += item.qty;
      } else {
        _lines.add(line);
      }
      added += item.qty;
    }
    notifyListeners();
    return added;
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

  /// Сколько штук этого товара в корзине — во всех конфигурациях сразу.
  /// В каталоге показывается один счётчик на товар, а не на строку.
  int qtyOf(Product product) => _lines
      .where((l) => l.product.id == product.id)
      .fold(0, (sum, l) => sum + l.qty);

  /// Убрать одну штуку прямо из каталога.
  ///
  /// Уменьшаем последнюю строку с этим товаром: если у товара несколько
  /// конфигураций, гадать, какую из них имел в виду человек, бессмысленно —
  /// разбирать состав он пойдёт в корзину.
  void decrementProduct(Product product) {
    final index = _lines.lastIndexWhere((l) => l.product.id == product.id);
    if (index < 0) return;
    _lines[index].qty--;
    if (_lines[index].qty <= 0) _lines.removeAt(index);
    notifyListeners();
  }

  List<Map<String, dynamic>> toApiItems() =>
      _lines.map((l) => l.toApiJson()).toList();
}
