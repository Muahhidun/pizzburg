import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/themes.dart';

/// Выбранное оформление.
///
/// Хранится на устройстве, а не в профиле: тему выбирают под себя и под
/// свой телефон, и гость, который не входил, имеет на это такое же право,
/// как и постоянный клиент.
class ThemeStore extends ChangeNotifier {
  static const _key = 'pizzburg_theme';

  AppThemeVariant _current = appThemes.first;
  AppThemeVariant get current => _current;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    _current = themeById(prefs.getString(_key));
    notifyListeners();
  }

  Future<void> select(AppThemeVariant variant) async {
    if (variant.id == _current.id) return;
    _current = variant;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, variant.id);
  }
}
