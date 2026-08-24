import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Язык приложения.
///
/// Два, а не список локалей: заведение работает в Казахстане, и языка
/// здесь ровно два — русский и казахский. Английский добавлять некому и
/// незачем, а пустая заготовка под него всю дорогу требовала бы третьей
/// колонки в каждой строке (DECISIONS §12.30).
enum AppLang {
  ru('ru', 'Русский'),
  kk('kk', 'Қазақша');

  const AppLang(this.code, this.title);
  final String code;
  final String title;

  static AppLang byCode(String? code) =>
      values.firstWhere((l) => l.code == code, orElse: () => AppLang.ru);
}

/// Текущий язык, доступный отовсюду.
///
/// Глобальная переменная здесь сознательна. Названия блюд приходят с
/// сервера сразу на двух языках, и выбор между ними нужен внутри модели
/// (`product.name`) — то есть там, где нет `BuildContext`. Альтернатива —
/// протаскивать язык параметром через каждый виджет и каждую модель;
/// это шумнее и ошибиться в ней проще, чем в одной переменной, которую
/// пишет только [LangStore].
class L {
  L._();

  static AppLang current = AppLang.ru;

  /// Казахский пустой — показываем русский.
  ///
  /// Перевод меню наполняется по позиции, и непереведённое блюдо должно
  /// остаться блюдом, а не пустой строкой в каталоге.
  static String pick(String ru, String? kk) =>
      current == AppLang.kk && kk != null && kk.trim().isNotEmpty ? kk : ru;

  static bool get isKk => current == AppLang.kk;
}

/// Выбранный язык — на устройстве, как и тема.
///
/// Не в профиле: язык выбирают под себя, и человек без входа имеет на
/// это такое же право, как постоянный клиент.
class LangStore extends ChangeNotifier {
  static const _key = 'pizzburg_lang';

  AppLang get current => L.current;

  /// Кому сказать, что язык сменился.
  ///
  /// Нужен пушам: их текст выбирает сервер по языку устройства, и он
  /// узнаёт о смене только когда токен перерегистрируют. Без этого
  /// человек переключился на казахский, а «Заказ готов» приходит
  /// по-русски — и так до следующего входа.
  Future<void> Function()? onChanged;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    L.current = AppLang.byCode(prefs.getString(_key));
    notifyListeners();
  }

  Future<void> select(AppLang lang) async {
    if (lang == L.current) return;
    L.current = lang;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, lang.code);
    await onChanged?.call();
  }
}
