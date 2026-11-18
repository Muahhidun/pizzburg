import 'package:flutter/foundation.dart';
import 'package:in_app_review/in_app_review.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Просьба оценить приложение в App Store / Google Play.
///
/// Спрашиваем того, кто уже получил несколько заказов: значит, приложение
/// у него работает и он вернулся. Пороги — 2, 6 и 15 доставленных
/// заказов, на каждом не больше одного раза. Окно системное: сколько раз
/// в год его реально показать, решают Apple и Google, а не мы.
///
/// Ничего не спрашиваем до окна («Вам нравится?») и не зависим от оценки
/// в нашей анкете: так требуют правила Google — просить оценку только у
/// довольных нельзя.
class StoreReview {
  static const thresholds = [2, 6, 15];
  static const _key = 'store_review_asked_at';
  static bool _busy = false;

  static Future<void> maybeAsk(List<dynamic> orders) async {
    if (kIsWeb || _busy) return;
    _busy = true;
    try {
      final delivered = orders
          .whereType<Map>()
          .where((o) => o['status'] == 'DELIVERED')
          .length;
      final prefs = await SharedPreferences.getInstance();
      final asked = prefs.getInt(_key) ?? 0;
      final due = nextThreshold(delivered, asked);
      if (due == null) return;
      final review = InAppReview.instance;
      if (!await review.isAvailable()) return;
      await prefs.setInt(_key, due);
      await review.requestReview();
    } catch (e) {
      debugPrint('Окно оценки не показано: $e');
    } finally {
      _busy = false;
    }
  }

  /// Порог, на котором пора спросить, или null
  @visibleForTesting
  static int? nextThreshold(int delivered, int askedAt) {
    int? due;
    for (final t in thresholds) {
      if (delivered >= t && t > askedAt) due = t;
    }
    return due;
  }
}
