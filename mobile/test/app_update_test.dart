import 'package:flutter_test/flutter_test.dart';
import 'package:pizzburg/services/app_config.dart';
import 'package:pizzburg/services/store_review.dart';
import 'package:pizzburg/widgets/update_prompt.dart';

void main() {
  group('минимальная версия', () {
    test('сравнение по числам, а не по строкам', () {
      expect(isOlder('1.0.0', '1.0.1'), isTrue);
      expect(isOlder('1.0.9', '1.0.10'), isTrue);
      expect(isOlder('1.1.0', '1.0.9'), isFalse);
      expect(isOlder('1.0.1', '1.0.1'), isFalse);
      expect(isOlder('2.0.0', '1.9.9'), isFalse);
      expect(isOlder('1.0.1+5', '1.0.1'), isFalse);
    });
  });

  group('просьба оценить', () {
    test('пороги 2, 6, 15 — каждый один раз', () {
      expect(StoreReview.nextThreshold(1, 0), isNull);
      expect(StoreReview.nextThreshold(2, 0), 2);
      expect(StoreReview.nextThreshold(3, 2), isNull);
      expect(StoreReview.nextThreshold(7, 2), 6);
      // Пропустил несколько порогов — спрашиваем один раз, по последнему
      expect(StoreReview.nextThreshold(20, 0), 15);
      expect(StoreReview.nextThreshold(20, 15), isNull);
    });
  });

  group('мягкое напоминание обновиться', () {
    final now = DateTime(2026, 11, 28, 12);
    int ago(Duration d) => now.subtract(d).millisecondsSinceEpoch;
    test('первый раз — показываем', () {
      expect(UpdatePrompt.due(null, now), isTrue);
    });
    test('после показа молчим два дня', () {
      expect(UpdatePrompt.due(ago(const Duration(hours: 5)), now), isFalse);
      expect(
        UpdatePrompt.due(ago(const Duration(days: 1, hours: 23)), now),
        isFalse,
      );
      expect(UpdatePrompt.due(ago(const Duration(days: 2)), now), isTrue);
    });
  });
}
