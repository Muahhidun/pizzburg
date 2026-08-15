import 'package:flutter/material.dart';
import 'tokens.dart';

/// Тема приложения по направлению «Сигнал».
///
/// Два шрифта с разными ролями: **Unbounded** — только дисплейное
/// (заголовки экранов, суммы, баланс), **Golos Text** — весь остальной
/// интерфейс. Смешивать нельзя: дисплейный шрифт в подписи выглядит
/// крикливо, интерфейсный в заголовке — никак.
abstract final class AppTheme {
  static const _display = 'Unbounded';
  static const _text = 'Golos Text';

  static ThemeData build({
    Color accent = const Color(0xFF2B3BEE),
    Color benefit = const Color(0xFFD6F84C),
  }) {
    final colors = AppColors(accent: accent, benefit: benefit);

    return ThemeData(
      useMaterial3: true,
      fontFamily: _text,
      scaffoldBackgroundColor: colors.surface,
      colorScheme: ColorScheme.fromSeed(
        seedColor: colors.accent,
        primary: colors.accent,
        secondary: colors.benefit,
        surface: colors.surface,
        brightness: Brightness.light,
      ),
      extensions: [colors],
      splashFactory: InkRipple.splashFactory,
      textTheme: _textTheme(colors),
      // Переходы экранов — общая ось вместо платформенного push: каталог,
      // карточка и корзина ощущаются одним потоком, а не стопкой окон.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.iOS: _SharedAxisTransitions(),
          TargetPlatform.android: _SharedAxisTransitions(),
          TargetPlatform.macOS: _SharedAxisTransitions(),
        },
      ),
    );
  }

  /// Типографика по хендоффу, но на ступень крупнее.
  ///
  /// Исходная таблица рассчитана на макет 390 pt и ставит нижнюю границу
  /// 10.5 — на реальном телефоне названия блюд и цены читались мелко.
  /// Подняты **главные** размеры: названия, цены, суммы, заголовки.
  /// Второстепенное (состав, микроподписи) поднято на пол-ступени —
  /// иерархия должна сохраниться, иначе экран превращается в кашу.
  static TextTheme _textTheme(AppColors c) => TextTheme(
    // Баланс баллов
    displayLarge: TextStyle(
      fontFamily: _display,
      fontSize: 42,
      height: 1,
      fontWeight: FontWeight.w700,
      letterSpacing: -1.6,
      color: c.ink,
    ),
    // Заголовок этапа на экране статуса
    displayMedium: TextStyle(
      fontFamily: _display,
      fontSize: 32,
      height: 1.05,
      fontWeight: FontWeight.w700,
      letterSpacing: -1.2,
      color: c.ink,
    ),
    // «Тот же заказ?» в хедере каталога
    displaySmall: TextStyle(
      fontFamily: _display,
      fontSize: 29,
      height: 1.1,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.81,
      color: c.ink,
    ),
    // Заголовки экранов
    headlineMedium: TextStyle(
      fontFamily: _display,
      fontSize: 26,
      height: 1.1,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.72,
      color: c.ink,
    ),
    // Сумма в кнопке
    titleLarge: TextStyle(
      fontFamily: _display,
      fontSize: 19,
      height: 1,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.36,
      color: c.ink,
    ),
    // Цена в строке списка
    titleMedium: TextStyle(
      fontFamily: _display,
      fontSize: 16,
      height: 1,
      fontWeight: FontWeight.w700,
      color: c.ink,
    ),
    // Название товара
    bodyLarge: TextStyle(
      fontSize: 16,
      height: 1.25,
      fontWeight: FontWeight.w600,
      color: c.ink,
    ),
    // Строка корзины
    bodyMedium: TextStyle(
      fontSize: 15,
      height: 1.3,
      fontWeight: FontWeight.w400,
      color: c.ink,
    ),
    // Подписи
    bodySmall: TextStyle(fontSize: 13, height: 1.4, color: c.muted),
    // Кнопки и пилюли
    labelLarge: TextStyle(
      fontSize: 13.5,
      height: 1,
      fontWeight: FontWeight.w600,
      color: c.ink,
    ),
    // Состав товара
    labelMedium: TextStyle(fontSize: 12, height: 1.45, color: c.muted),
    // Микроподписи — нижняя граница читаемости, мельче не опускаться
    labelSmall: TextStyle(
      fontSize: 11.5,
      height: 1,
      fontWeight: FontWeight.w500,
      color: c.muted,
    ),
  );
}

/// Общая ось: уходящий экран сдвигается и растворяется, приходящий
/// приезжает с той же стороны. Дешевле и спокойнее, чем полноценный
/// Material shared-axis, и не требует лишнего пакета.
///
/// Свой переход отменяет штатный купертиновский, а вместе с ним — и свайп
/// от левого края «назад»: жест живёт не в анимации, а в детекторе внутри
/// `CupertinoPageTransitionsBuilder`. Поэтому мы этот строитель всё-таки
/// вызываем, но его собственную анимацию гасим постоянными значениями:
/// при завершённой основной и погашенной вторичной он рисует ребёнка без
/// сдвига, отдавая ровно то, ради чего нужен, — детектор. Тянут жестом при
/// этом `route.controller`, то есть нашу же анимацию, и переход честно
/// отматывается назад под пальцем.
class _SharedAxisTransitions extends PageTransitionsBuilder {
  const _SharedAxisTransitions();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final enter = CurvedAnimation(parent: animation, curve: Motion.enter);
    final exit = CurvedAnimation(parent: secondaryAnimation, curve: Motion.change);

    final visual = FadeTransition(
      opacity: enter,
      child: SlideTransition(
        position: Tween(
          begin: const Offset(0.06, 0),
          end: Offset.zero,
        ).animate(enter),
        child: SlideTransition(
          position: Tween(
            begin: Offset.zero,
            end: const Offset(-0.04, 0),
          ).animate(exit),
          child: child,
        ),
      ),
    );

    return const CupertinoPageTransitionsBuilder().buildTransitions<T>(
      route,
      context,
      kAlwaysCompleteAnimation,
      kAlwaysDismissedAnimation,
      visual,
    );
  }
}

/// Быстрый доступ к палитре: `context.colors.accent`
extension AppColorsX on BuildContext {
  AppColors get colors => Theme.of(this).extension<AppColors>() ?? AppColors();
}
