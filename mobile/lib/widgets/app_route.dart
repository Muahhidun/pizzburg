import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Самая широкая колонка для «телефонных» экранов: карточка блюда,
/// корзина, оформление, заказ, профиль. Шире строки списков и формы
/// становятся неудобными, поэтому на планшете и компьютере такие экраны
/// стоят колонкой по центру, а не растягиваются на всё окно.
const kNarrowMaxWidth = 600.0;

/// Самая широкая колонка всего приложения на большом мониторе: меню
/// дальше не растёт, иначе карточки разъезжаются по углам экрана.
const kAppMaxWidth = 1280.0;

/// Поля вокруг колонки. В тёмной теме светлая рамка вокруг тёмного
/// приложения била бы в глаза.
Color backdropColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF0B0D12)
    : const Color(0xFFF2F2F3);

/// Ставит экран колонкой не шире [maxWidth] по центру.
///
/// Экраны считают размеры от `MediaQuery.sizeOf(context)`, а не от своих
/// ограничений, поэтому вместе с колонкой подменяем и ширину в MediaQuery —
/// иначе фото и ряды считались бы по ширине окна и вытягивались.
class NarrowColumn extends StatelessWidget {
  final Widget child;
  final double maxWidth;

  /// Цвет полей; по умолчанию серый, чтобы колонка читалась отдельным
  /// листом. Разделы сайта под шапкой лежат на белом, как обычная страница.
  final Color? backdrop;

  const NarrowColumn({
    super.key,
    required this.child,
    this.maxWidth = kNarrowMaxWidth,
    this.backdrop,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth <= maxWidth) return child;
        final media = MediaQuery.of(context);
        return ColoredBox(
          color: backdrop ?? backdropColor(context),
          child: Center(
            child: SizedBox(
              width: maxWidth,
              child: MediaQuery(
                data: media.copyWith(size: Size(maxWidth, media.size.height)),
                child: ClipRect(child: child),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Окно поверх сайта на компьютере: карточка блюда, оформление, вход,
/// оплата, заказ.
///
/// Телефонные экраны на мониторе раньше открывались узкой полосой во всю
/// высоту с серыми полями — казалось, что сайт «сломался» и перестал быть
/// адаптированным. Окном поверх меню они читаются как шаг на той же
/// странице: меню и корзина видны за затемнением, и человек понимает, что
/// никуда не ушёл. Размер у всех окон один, поэтому следующий шаг
/// (оформление → вход → оплата) ложится ровно поверх предыдущего.
class DesktopWindow extends StatelessWidget {
  final Widget child;
  const DesktopWindow({super.key, required this.child});

  static const double width = 600;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final height = math.min(880.0, media.size.height - 64);
    return Center(
      child: DecoratedBox(
        decoration: const BoxDecoration(
          borderRadius: R.block,
          boxShadow: [
            BoxShadow(
              color: Color(0x33000000),
              blurRadius: 40,
              offset: Offset(0, 12),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: R.block,
          child: SizedBox(
            width: width,
            height: height,
            child: MediaQuery(
              data: media.copyWith(
                size: Size(width, height),
                padding: EdgeInsets.zero,
                viewPadding: EdgeInsets.zero,
              ),
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}

/// Обычный переход между экранами. На планшете экран стоит колонкой по
/// центру (см. [NarrowColumn]), на компьютере — окном поверх сайта
/// (см. [DesktopWindow]).
class AppRoute<T> extends MaterialPageRoute<T> {
  AppRoute({
    required WidgetBuilder builder,
    RouteSettings? settings,
    bool maintainState = true,
    bool fullscreenDialog = false,
  }) : this._(
         builder,
         settings,
         maintainState,
         fullscreenDialog,
         _desktopWindow(),
       );

  // Окно помечено как диалог: тогда экран под ним не уезжает в сторону
  // анимацией перехода, а остаётся на месте за затемнением.
  AppRoute._(
    WidgetBuilder builder,
    RouteSettings? settings,
    bool maintainState,
    bool fullscreenDialog,
    this._window,
  ) : super(
        builder: builder,
        settings: settings,
        maintainState: maintainState,
        fullscreenDialog: fullscreenDialog || _window,
      );

  /// Решается один раз при открытии: прозрачность маршрута навигатор
  /// читает, когда кладёт его в стек, и поменять её потом нельзя.
  final bool _window;

  /// Окно поверх другого окна не затемняет фон второй раз
  bool _stacked = false;

  static bool _desktopWindow() {
    final view = WidgetsBinding.instance.platformDispatcher.implicitView;
    if (view == null) return false;
    return view.physicalSize.width / view.devicePixelRatio >= kDesktopMinWidth;
  }

  @override
  bool get opaque => !_window;

  @override
  Color? get barrierColor =>
      _window && !_stacked ? Colors.black.withValues(alpha: 0.5) : null;

  @override
  void didChangePrevious(Route<dynamic>? previousRoute) {
    _stacked =
        (previousRoute is AppRoute && previousRoute._window) ||
        previousRoute is PopupRoute;
    super.didChangePrevious(previousRoute);
  }

  @override
  Widget buildContent(BuildContext context) {
    final page = super.buildContent(context);
    return _window ? DesktopWindow(child: page) : NarrowColumn(child: page);
  }

  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (!_window) {
      return super.buildTransitions(
        context,
        animation,
        secondaryAnimation,
        child,
      );
    }
    final curved = CurvedAnimation(parent: animation, curve: Motion.enter);
    return FadeTransition(
      opacity: curved,
      child: ScaleTransition(
        scale: Tween(begin: 0.97, end: 1.0).animate(curved),
        child: child,
      ),
    );
  }
}
