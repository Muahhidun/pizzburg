import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/screens/cart_screen.dart';
import 'package:pizzburg/theme/app_theme.dart';

/// Баллы в корзине — одна строка с переключателем (Дом, 28.11.2026)
void main() {
  Future<List<int>> pump(
    WidgetTester tester, {
    int value = 0,
    int max = 975,
    int balance = 1480,
    bool blocked = false,
  }) async {
    final toggled = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.build(),
        home: Scaffold(
          body: PointsRow(
            value: value,
            max: max,
            balance: balance,
            blockedByPromo: blocked,
            onSlide: (_) {},
            onToggle: toggled.add,
          ),
        ),
      ),
    );
    return toggled;
  }

  String plain(String s) => s.replaceAll(RegExp('[  ]'), ' ');
  bool shows(String text) => find
      .byWidgetPredicate((w) => w is Text && plain(w.data ?? '') == text)
      .evaluate()
      .isNotEmpty;

  testWidgets(
    'выключено: баланс и сколько можно списать; включение — максимум',
    (tester) async {
      final toggled = await pump(tester);
      expect(shows('Баллы: 1 480'), isTrue);
      expect(shows('можно списать 975 ₸'), isTrue);
      await tester.tap(find.byType(Switch));
      expect(toggled, [975]);
    },
  );

  testWidgets('включено: «спишем», выключение — ноль', (tester) async {
    final toggled = await pump(tester, value: 975);
    expect(shows('спишем 975 ₸'), isTrue);
    await tester.tap(find.byType(Switch));
    expect(toggled, [0]);
  });

  testWidgets('«Списать часть» раскрывает ползунок', (tester) async {
    await pump(tester, value: 975);
    expect(find.byType(Slider), findsNothing);
    await tester.tap(find.text('Списать часть'));
    await tester.pump();
    expect(find.byType(Slider), findsOneWidget);
  });

  testWidgets('акция в заказе — переключатель неактивен и объяснение', (
    tester,
  ) async {
    final toggled = await pump(tester, blocked: true);
    expect(shows('Не суммируются с акцией в заказе'), isTrue);
    await tester.tap(find.byType(Switch));
    expect(toggled, isEmpty);
  });

  testWidgets('баллов нет — «начислим за этот заказ»', (tester) async {
    await pump(tester, max: 0, balance: 0);
    expect(shows('Баллов пока нет — начислим за этот заказ'), isTrue);
  });
}
