import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/api/models.dart';
import 'package:pizzburg/state/cart.dart';
import 'package:pizzburg/utils/input_validation.dart';

void main() {
  test('formatTenge разделяет разряды', () {
    expect(formatTenge(2550), '2 550 ₸');
    expect(formatTenge(950), '950 ₸');
    expect(formatTenge(12500), '12 500 ₸');
  });

  test('карточка товара читает витринные поля', () {
    final product = Product.fromJson({
      'id': 'pizza-1',
      'name': 'Пепперони',
      'description': 'Состав',
      'photoUrl': 'https://example.com/pizza.jpg',
      'weightLabel': '30 см',
      'isHit': true,
      'isSpicy': true,
      'isNew': false,
      'price': 3150,
      'modifierGroups': <dynamic>[],
    });

    expect(product.weightLabel, '30 см');
    expect(product.isHit, isTrue);
    expect(product.isSpicy, isTrue);
    expect(product.isNew, isFalse);
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

  test('телефон форматируется и лишние символы не проходят', () {
    final formatter = KzPhoneInputFormatter();
    final formatted = formatter.formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(text: '+7 707 127 27 89*#999'),
    );

    expect(formatted.text, '+7 (707) 127-27-89');
    expect(validateKzPhone(formatted.text), isNull);
    expect(validateKzPhone('+770712727894646*#'), isNotNull);
  });

  test('поля оформления отклоняют некорректные значения', () {
    expect(validateName('Жандос'), isNull);
    expect(validateName('Жандос123'), isNotNull);
    expect(validateHouse('47Б'), isNull);
    expect(validateHouse('бар'), isNotNull);
    expect(validateFlat('6А'), isNull);
    expect(validateFlat('бар'), isNotNull);
    expect(validateEntrance('Пер'), isNotNull);
    expect(validateFloor('9'), isNull);
    expect(validateFloor('Первый'), isNotNull);
  });
}
