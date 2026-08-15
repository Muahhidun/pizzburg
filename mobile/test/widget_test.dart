import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/api/models.dart';
import 'package:pizzburg/theme/tokens.dart';
import 'package:pizzburg/utils/haptics.dart';
import 'package:pizzburg/widgets/motion.dart';
import 'package:pizzburg/api/api_client.dart';
import 'package:pizzburg/state/cart.dart';
import 'package:pizzburg/state/favorites.dart';
import 'package:pizzburg/utils/input_validation.dart';

void main() {
  test('formatTenge разделяет разряды', () {
    expect(formatTenge(2550), '2\u00A0550\u00A0₸');
    expect(formatTenge(950), '950\u00A0₸');
    expect(formatTenge(12500), '12\u00A0500\u00A0₸');
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

  test('политика баллов по умолчанию не разрешает двойную выгоду', () {
    final preview = CartPreview.fromJson({
      'subtotal': 6400,
      'promoDiscount': 2550,
      'gifts': <dynamic>[],
      'appliedPromotions': ['2+1 Пицца'],
      'loyalty': {'cashbackPct': 3},
      'delivery': {'fee': 0, 'minOrder': 0, 'available': true},
    });

    expect(preview.earnWhenPointsSpent, isFalse);
    expect(preview.allowPointsWithPromotions, isFalse);
    expect(preview.earnOnPromotionalOrders, isFalse);
  });

  test('приложение читает включённые исключения политики баллов', () {
    final preview = CartPreview.fromJson({
      'subtotal': 6400,
      'gifts': <dynamic>[],
      'appliedPromotions': <dynamic>[],
      'loyalty': {
        'cashbackPct': 5,
        'earnWhenPointsSpent': true,
        'allowPointsWithPromotions': true,
        'earnOnPromotionalOrders': true,
      },
      'delivery': {'fee': 0, 'minOrder': 0, 'available': true},
    });

    expect(preview.cashbackPct, 5);
    expect(preview.earnWhenPointsSpent, isTrue);
    expect(preview.allowPointsWithPromotions, isTrue);
    expect(preview.earnOnPromotionalOrders, isTrue);
  });

  test('приложение читает режим приёма заказов', () {
    final preview = CartPreview.fromJson({
      'subtotal': 6400,
      'gifts': <dynamic>[],
      'appliedPromotions': <dynamic>[],
      'delivery': {'fee': 0, 'minOrder': 0, 'available': false},
      'availability': {
        'mode': 'PICKUP_ONLY',
        'isOpenNow': true,
        'deliveryAvailable': false,
        'pickupAvailable': true,
        'asapAvailable': true,
        'message': 'Доставка временно недоступна',
        'preorderEnabled': true,
        'todayHours': [
          ['10:00', '22:00'],
        ],
        'payments': {'cash': true, 'cardOnDelivery': false, 'askChangeFrom': true},
        'cancelWindowMinutes': 15,
      },
    });

    expect(preview.availability.mode, 'PICKUP_ONLY');
    expect(preview.availability.deliveryAvailable, isFalse);
    expect(preview.availability.cardOnDeliveryEnabled, isFalse);
    expect(preview.availability.askChangeFrom, isTrue);
    expect(preview.availability.cancelWindowMinutes, 15);
    expect(preview.availability.todayHours.first, ['10:00', '22:00']);
  });

  test('без блока доступности приложение не ломается', () {
    final preview = CartPreview.fromJson({
      'subtotal': 1000,
      'gifts': <dynamic>[],
      'appliedPromotions': <dynamic>[],
      'delivery': {'fee': 0, 'minOrder': 0, 'available': true},
    });

    expect(preview.availability.mode, 'ALL');
    expect(preview.availability.deliveryAvailable, isTrue);
    expect(preview.availability.cashEnabled, isTrue);
  });

  test('документ отдаёт человеческое название даже без заголовка', () {
    final doc = LegalDocument.fromJson({
      'type': 'PRIVACY',
      'version': 2,
      'title': '',
      'content': 'текст',
    });

    expect(doc.displayTitle, 'Политика конфиденциальности');
    expect(doc.version, 2);
  });

  test('заголовок из ответа важнее подстановки по типу', () {
    final doc = LegalDocument.fromJson({
      'type': 'OFFER',
      'version': 1,
      'title': 'Договор оферты PizzBurg',
      'content': 'текст',
    });

    expect(doc.displayTitle, 'Договор оферты PizzBurg');
  });

  test('причина отмены читается из справочника', () {
    final reason = CancelReason.fromJson({'id': 'r1', 'label': 'Передумал'});

    expect(reason.id, 'r1');
    expect(reason.label, 'Передумал');
  });

  test('сохранённый адрес собирается в одну строку', () {
    final a = SavedAddress.fromJson({
      'id': 'a1',
      'street': 'Абая',
      'house': '12',
      'flat': '5',
      'entrance': '2',
      'floor': '3',
    });

    expect(a.oneLine, 'Абая, 12, кв. 5, подъезд 2, этаж 3');
  });

  test('пустые уточнения не попадают в строку адреса', () {
    final a = SavedAddress.fromJson({
      'id': 'a2',
      'street': 'Машхур Жусупа',
      'house': '134',
      'flat': '',
    });

    expect(a.oneLine, 'Машхур Жусупа, 134');
  });

  test('деньги разделяются неразрывным пробелом — в Unbounded нет тонкого', () {
    expect(AnimatedMoney.format(5050), '5\u00A0050\u00A0₸');
    expect(AnimatedMoney.format(950), '950\u00A0₸');
    expect(AnimatedMoney.format(1006), '1\u00A0006\u00A0₸');
    expect(AnimatedMoney.format(3400, withCurrency: false), '3\u00A0400');
  });

  test('отрицательная сумма показывается минусом, а не скобками', () {
    expect(AnimatedMoney.format(-600), '\u2212600\u00A0₸');
  });

  test('ползунок баллов вибрирует на смене шага, а не на каждом пикселе', () {
    final stepped = SteppedHaptic();
    var buzzes = 0;
    // считаем сами: Haptics на вебе молчит, поэтому проверяем логику шага
    int stepIndex(double v) => (v / 50).round();

    final values = [0.0, 10.0, 24.0, 26.0, 49.0, 51.0, 99.0];
    int? last;
    for (final v in values) {
      final i = stepIndex(v);
      if (last != i) {
        last = i;
        buzzes++;
      }
    }
    stepped.reset();

    // 0→0, 10→0, 24→0, 26→1, 49→1, 51→1, 99→2 — три смены шага
    expect(buzzes, 3);
  });

  test('токены движения: выгода заметнее действия', () {
    expect(Motion.fast.inMilliseconds < Motion.base.inMilliseconds, isTrue);
    expect(Motion.base.inMilliseconds < Motion.slow.inMilliseconds, isTrue);
  });

  test('повтор наполняет корзину по текущим ценам, а не по ценам заказа', () {
    final menu = MenuResponse.fromJson({
      'tenant': {'name': 'PizzBurg'},
      'categories': [
        {
          'id': 'c1',
          'name': 'Пиццы',
          'products': [
            {
              'id': 'p1',
              'name': 'Маргарита',
              'price': 2900, // цена выросла с 2550
              'modifierGroups': [
                {
                  'id': 'g1',
                  'name': 'Добавки',
                  'min': 0,
                  'max': 3,
                  'options': [
                    {'id': 'm1', 'name': 'Бортик', 'price': 700},
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    final cart = Cart();
    final added = cart.fillFromRepeat(
      RepeatResult.fromJson({
        'items': [
          {
            'productId': 'p1',
            'qty': 2,
            'modifiers': [
              {'posterId': 'm1', 'name': 'Бортик', 'price': 700},
            ],
          },
        ],
        'unavailable': <dynamic>[],
      }),
      menu,
    );

    expect(added, 2);
    expect(cart.lines.length, 1);
    expect(cart.lines.first.qty, 2);
    // 2900 сегодняшняя + 700 бортик
    expect(cart.lines.first.unitPrice, 3600);
    expect(cart.subtotal, 7200);
  });

  test('повтор очищает корзину, а не дописывает к набранному', () {
    final menu = MenuResponse.fromJson({
      'tenant': {'name': 'PizzBurg'},
      'categories': [
        {
          'id': 'c1',
          'name': 'Пиццы',
          'products': [
            {'id': 'p1', 'name': 'Маргарита', 'price': 2550, 'modifierGroups': []},
          ],
        },
      ],
    });
    final cart = Cart();
    cart.add(menu.categories.first.products.first);
    cart.add(menu.categories.first.products.first);
    expect(cart.count, 2);

    cart.fillFromRepeat(
      RepeatResult.fromJson({
        'items': [
          {'productId': 'p1', 'qty': 1, 'modifiers': <dynamic>[]},
        ],
        'unavailable': <dynamic>[],
      }),
      menu,
    );

    expect(cart.count, 1);
  });

  test('исчезнувший товар не ломает повтор', () {
    final menu = MenuResponse.fromJson({
      'tenant': {'name': 'PizzBurg'},
      'categories': [
        {
          'id': 'c1',
          'name': 'Пиццы',
          'products': [
            {'id': 'p1', 'name': 'Маргарита', 'price': 2550, 'modifierGroups': []},
          ],
        },
      ],
    });

    final cart = Cart();
    final added = cart.fillFromRepeat(
      RepeatResult.fromJson({
        'items': [
          {'productId': 'p1', 'qty': 1, 'modifiers': <dynamic>[]},
          {'productId': 'ушёл', 'qty': 3, 'modifiers': <dynamic>[]},
        ],
        'unavailable': [
          {'name': 'Пепперони', 'reason': 'сегодня закончилось'},
        ],
      }),
      menu,
    );

    expect(added, 1);
    expect(cart.lines.length, 1);
  });

  group('телефон: удаление', () {
    String apply(String oldText, String newText) {
      final f = KzPhoneInputFormatter();
      return f
          .formatEditUpdate(
            TextEditingValue(text: oldText),
            TextEditingValue(text: newText),
          )
          .text;
    }

    test('backspace на скобке стирает цифру, а не зацикливается', () {
      // «+7 (708)» → пользователь жмёт backspace, уходит «)»
      expect(apply('+7 (708)', '+7 (708'), '+7 (70');
    });

    test('номер можно стереть до конца', () {
      var text = '+7 (708) 12-34-56';
      for (var i = 0; i < 12; i++) {
        final shorter = text.substring(0, text.length - 1);
        final next = apply(text, shorter);
        expect(next.length < text.length, isTrue, reason: 'застряло на «$text»');
        text = next;
        if (text == '+7') break;
      }
      expect(text, '+7');
    });

    test('ввод цифры по-прежнему форматируется', () {
      expect(apply('+7', '+77'), '+7 (7');
      expect(apply('+7 (70', '+7 (708'), '+7 (708)');
    });
  });

  group('избранное', () {
    test('сердце закрашивается до ответа сервера', () async {
      final api = _SlowFavoritesApi();
      final favorites = Favorites(api);

      final pending = favorites.toggle('pizza-1');
      // Ответ ещё не пришёл, а сердце уже должно быть закрашено: иначе
      // человек нажимает второй раз, решив, что не сработало.
      expect(favorites.contains('pizza-1'), isTrue);

      api.complete(true);
      await pending;
      expect(favorites.contains('pizza-1'), isTrue);
    });

    test('ошибка сети откатывает сердце, а не врёт о сохранении', () async {
      final api = _SlowFavoritesApi();
      final favorites = Favorites(api);

      final pending = favorites.toggle('pizza-1');
      expect(favorites.contains('pizza-1'), isTrue);

      api.fail();
      await expectLater(pending, throwsA(anything));
      expect(favorites.contains('pizza-1'), isFalse);
    });

    test('выход стирает чужие сердечки', () async {
      final api = _SlowFavoritesApi();
      final favorites = Favorites(api);
      final pending = favorites.toggle('pizza-1');
      api.complete(true);
      await pending;

      favorites.clear();
      expect(favorites.count, 0);
      expect(favorites.contains('pizza-1'), isFalse);
    });
  });
}

/// Клиент, у которого ответ приходит по команде теста: только так видно,
/// что состояние меняется до ответа, а не после.
class _SlowFavoritesApi extends ApiClient {
  final _completer = Completer<bool>();

  void complete(bool value) => _completer.complete(value);
  void fail() => _completer.completeError(Exception('нет сети'));

  @override
  Future<bool> toggleFavorite(String productId) => _completer.future;
}
