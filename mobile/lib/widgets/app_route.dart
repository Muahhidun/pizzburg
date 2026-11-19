import 'package:flutter/material.dart';

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

  const NarrowColumn({
    super.key,
    required this.child,
    this.maxWidth = kNarrowMaxWidth,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth <= maxWidth) return child;
        final media = MediaQuery.of(context);
        return ColoredBox(
          color: backdropColor(context),
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

/// Обычный переход между экранами, только на широком окне экран стоит
/// колонкой по центру (см. [NarrowColumn]).
class AppRoute<T> extends MaterialPageRoute<T> {
  AppRoute({
    required super.builder,
    super.settings,
    super.maintainState,
    super.fullscreenDialog,
  });

  @override
  Widget buildContent(BuildContext context) =>
      NarrowColumn(child: super.buildContent(context));
}
