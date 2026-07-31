import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/api/models.dart';
import 'package:pizzburg/state/cart.dart';

void main() {
  test('formatTenge разделяет разряды', () {
    expect(formatTenge(2550), '2 550 ₸');
    expect(formatTenge(950), '950 ₸');
    expect(formatTenge(12500), '12 500 ₸');
  });

  test('корзина схлопывает одинаковые позиции и считает сумму', () {
    final pizza = Product(
      id: 'p1',
      name: 'Маргарита',
      description: '',
      price: 2550,
      modifierGroups: const [],
    );
    final cart = Cart();
    cart.add(pizza);
    cart.add(pizza);

    expect(cart.lines.length, 1);
    expect(cart.count, 2);
    expect(cart.subtotal, 5100);
  });

  test('одинаковый товар с разными модификаторами — разные строки', () {
    final set = Product(
      id: 'p2',
      name: 'Маки сет',
      description: '',
      price: 5000,
      modifierGroups: const [],
    );
    final cola = ModifierOption(id: 'm1', name: 'Кола', price: 0);
    final fanta = ModifierOption(id: 'm2', name: 'Фанта', price: 0);

    final cart = Cart();
    cart.add(set, modifiers: [cola]);
    cart.add(set, modifiers: [fanta]);

    expect(cart.lines.length, 2);
    expect(cart.subtotal, 10000);
  });

  test('модификатор с доплатой попадает в цену позиции', () {
    final set = Product(
      id: 'p3',
      name: 'Сет',
      description: '',
      price: 5000,
      modifierGroups: const [],
    );
    final bigCola = ModifierOption(id: 'm3', name: 'Кола 1л', price: 750);

    final cart = Cart();
    cart.add(set, modifiers: [bigCola]);

    expect(cart.subtotal, 5750);
  });
}
