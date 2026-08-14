import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Тактильная отдача по смыслу действия, а не по типу виджета.
///
/// Зачем отдельный слой, а не `HapticFeedback` по месту:
/// — вибрация должна быть **редкой и осмысленной**. Разбросанные по экранам
///   вызовы неизбежно превращаются в дрожь на каждый тап, и её начинают
///   отключать в системе — вместе с полезными сигналами;
/// — её нужно уметь выключить одной настройкой;
/// — на вебе тактильной отдачи нет вообще, и каждый вызов пришлось бы
///   оборачивать проверкой.
///
/// Правило выбора:
/// — [selection] — выбор из вариантов: чипсы, размер, адрес, шаг ползунка;
/// — [tap] — изменение количества, добавление в корзину;
/// — [success] — заказ создан, промокод применён, подарок разблокирован;
/// — [warning] — действие не прошло: промокода нет, товар в стопе.
abstract final class Haptics {
  static const _key = 'pizzburg_haptics_enabled';
  static bool _enabled = true;

  static bool get enabled => _enabled;

  /// Вибрация есть только на телефонах. Web и десктоп молчат.
  static bool get _supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.android);

  static Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    _enabled = prefs.getBool(_key) ?? true;
  }

  static Future<void> setEnabled(bool value) async {
    _enabled = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, value);
  }

  static bool get _on => _enabled && _supported;

  /// Выбор одного из вариантов. Самый частый и самый тихий сигнал.
  static void selection() {
    if (_on) HapticFeedback.selectionClick();
  }

  /// Обычное действие: количество, добавление в корзину.
  static void tap() {
    if (_on) HapticFeedback.lightImpact();
  }

  /// Значимое событие: заказ создан, выгода получена.
  static void success() {
    if (_on) HapticFeedback.mediumImpact();
  }

  /// Действие не прошло. Двойной короткий импульс читается как «нет»
  /// и не путается с обычным подтверждением.
  static Future<void> warning() async {
    if (!_on) return;
    await HapticFeedback.mediumImpact();
    await Future<void>.delayed(const Duration(milliseconds: 90));
    await HapticFeedback.mediumImpact();
  }
}

/// Ползунок баллов дёргается по шагу, а не по каждому пикселю: без этого
/// одно перетаскивание даёт сотни импульсов и телефон трещит.
class SteppedHaptic {
  int? _last;

  void onValue(double value, {double step = 50}) {
    final index = (value / step).round();
    if (_last == index) return;
    _last = index;
    Haptics.selection();
  }

  void reset() => _last = null;
}
