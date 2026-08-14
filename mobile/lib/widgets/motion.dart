import 'package:flutter/material.dart';
import '../api/models.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';

/// Нажатие с лёгким сжатием.
///
/// Заменяет `InkWell` там, где рябь Material выглядит чужеродно: на
/// капсулах и чипсах она обрезается по прямоугольнику и портит форму.
/// Сжатие даёт ту же обратную связь и работает на любой геометрии.
class PressScale extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;

  /// Насколько сжимать. Для крупных кнопок хватает меньшего.
  final double scale;

  /// Тактильный отклик; для выбора из вариантов передавайте
  /// `Haptics.selection`.
  final VoidCallback? feedback;

  const PressScale({
    super.key,
    required this.child,
    this.onTap,
    this.scale = 0.96,
    this.feedback,
  });

  /// Вариант для чипсов и переключателей
  const PressScale.selection({
    super.key,
    required this.child,
    this.onTap,
    this.scale = 0.97,
  }) : feedback = Haptics.selection;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _down = false;

  void _set(bool value) {
    if (_down != value) setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: enabled ? (_) => _set(true) : null,
      onTapCancel: enabled ? () => _set(false) : null,
      onTapUp: enabled ? (_) => _set(false) : null,
      onTap: enabled
          ? () {
              (widget.feedback ?? Haptics.tap)();
              widget.onTap!();
            }
          : null,
      child: AnimatedScale(
        scale: _down && enabled ? widget.scale : 1,
        duration: Motion.fast,
        curve: Motion.change,
        child: widget.child,
      ),
    );
  }
}

/// Число, которое перекатывается к новому значению.
///
/// Нужен там, где сумма меняется от действия клиента: итог корзины,
/// цена позиции с добавками, списание баллов. Мгновенная подмена цифры
/// читается как «экран моргнул», плавный переход — как «моё действие
/// изменило вот это».
class AnimatedMoney extends StatelessWidget {
  final int value;
  final TextStyle? style;

  /// Показывать «₸». В строке списка символа нет, в итогах и кнопках — есть.
  final bool withCurrency;
  final Duration duration;

  const AnimatedMoney(
    this.value, {
    super.key,
    this.style,
    this.withCurrency = true,
    this.duration = Motion.base,
  });

  /// Формат один на всё приложение — см. `formatTenge`
  static String format(int value, {bool withCurrency = true}) =>
      formatTenge(value, withCurrency: withCurrency);

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: value.toDouble(), end: value.toDouble()),
      duration: duration,
      curve: Motion.change,
      builder: (_, animated, _) => Text(
        format(animated.round(), withCurrency: withCurrency),
        style: style,
      ),
    );
  }
}

/// Появление «выгоды»: подарок, списание баллов, пройденный этап.
///
/// Единственное место, где движение имеет право быть заметным — поэтому
/// длительность `slow` и кривая с перелётом. Всё остальное в приложении
/// движется незаметно.
class BenefitReveal extends StatelessWidget {
  final Widget child;
  final bool visible;

  const BenefitReveal({super.key, required this.child, this.visible = true});

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: Motion.slow,
      switchInCurve: Motion.benefit,
      switchOutCurve: Motion.change,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween(begin: 0.88, end: 1.0).animate(animation),
          child: child,
        ),
      ),
      child: visible ? child : const SizedBox.shrink(),
    );
  }
}

/// Каскадное появление списка при первой загрузке.
///
/// Индекс задаёт задержку: строки проявляются сверху вниз, и глаз
/// успевает считать структуру, а не получает всё разом.
class StaggeredEntrance extends StatelessWidget {
  final int index;
  final Widget child;

  /// После скольких строк перестать задерживать — иначе низ длинного
  /// списка появляется через секунды.
  final int maxStagger;

  const StaggeredEntrance({
    super.key,
    required this.index,
    required this.child,
    this.maxStagger = 8,
  });

  @override
  Widget build(BuildContext context) {
    final steps = index > maxStagger ? maxStagger : index;
    return TweenAnimationBuilder<double>(
      key: ValueKey(index),
      tween: Tween(begin: 0, end: 1),
      duration: Motion.base + Motion.stagger * steps,
      curve: Interval(
        steps * 0.06 > 0.6 ? 0.6 : steps * 0.06,
        1,
        curve: Motion.enter,
      ),
      builder: (_, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, 12 * (1 - t)), child: child),
      ),
      child: child,
    );
  }
}

/// Мерцание скелетона загрузки.
///
/// Хендофф требует скелетон, повторяющий структуру, и запрещает спиннер.
/// Без движения скелетон читается как сломанный экран, поэтому блик.
class Shimmer extends StatefulWidget {
  final Widget child;
  const Shimmer({super.key, required this.child});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, child) => ShaderMask(
        blendMode: BlendMode.srcATop,
        shaderCallback: (bounds) => LinearGradient(
          begin: Alignment(-1.5 + 3 * _c.value, 0),
          end: Alignment(-0.5 + 3 * _c.value, 0),
          colors: const [
            Color(0x00FFFFFF),
            Color(0x66FFFFFF),
            Color(0x00FFFFFF),
          ],
        ).createShader(bounds),
        child: child,
      ),
      child: widget.child,
    );
  }
}
