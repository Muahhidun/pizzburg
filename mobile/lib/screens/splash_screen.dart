import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../utils/haptics.dart';

/// Вторая стадия заставки: анимация поверх уже запущенного приложения.
///
/// Нативный экран запуска её показать не может — он статичен по устройству
/// обеих платформ и живёт до того, как поднимется движок Flutter. Поэтому
/// заставка двухслойная: нативный экран держит чёрный фон со знаком, пока
/// грузится движок, а этот виджет подхватывает тем же чёрным фоном и
/// доигрывает слова. Совпадение фонов до значения `#000000` — то, что
/// убирает вспышку на стыке.
///
/// Хаптик идёт через [Haptics], а не через `HapticFeedback` напрямую:
/// иначе заставка вибрировала бы даже с выключенной настройкой отдачи.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.onDone});

  /// Вызывается, когда заставку пора убрать.
  final VoidCallback onDone;

  /// Полная длительность вращения слов.
  static const spin = Duration(milliseconds: 1700);

  /// Предел удержания. Дальше показываем приложение независимо ни от чего:
  /// заставка не должна становиться местом ожидания данных.
  static const hold = Duration(milliseconds: 2000);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: SplashScreen.spin,
  )..forward();

  /// Пять щелчков прокрутки с растущим интервалом, затем два замка: слово
  /// «Pizz» садится на 1.38 с, «Burg» — на 1.70 с.
  static const _ticks = <int, _Tick>{
    100: _Tick.scroll,
    450: _Tick.scroll,
    750: _Tick.scroll,
    1000: _Tick.scroll,
    1200: _Tick.scroll,
    1380: _Tick.soft,
    1700: _Tick.hard,
  };

  final _timers = <Future<void>>[];

  @override
  void initState() {
    super.initState();
    for (final tick in _ticks.entries) {
      _timers.add(
        Future<void>.delayed(Duration(milliseconds: tick.key), () {
          if (!mounted) return;
          switch (tick.value) {
            case _Tick.scroll:
              Haptics.selection();
            case _Tick.soft:
              Haptics.success();
            case _Tick.hard:
              Haptics.lock();
          }
        }),
      );
    }
    Future<void>.delayed(SplashScreen.hold, () {
      if (mounted) widget.onDone();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  /// Два оборота вокруг вертикальной оси с торможением. Слова крутятся в
  /// противоположные стороны, и нижнее садится позже — иначе они читаются
  /// как одна деталь, а не как две.
  double _angle(double t, {required bool reverse}) {
    final end = reverse ? 0.94 : 0.81;
    final p = (t / end).clamp(0.0, 1.0);
    return (reverse ? -1 : 1) *
        Curves.easeOutQuart.transform(p) *
        4 *
        math.pi;
  }

  @override
  Widget build(BuildContext context) {
    // Фон чёрный, поэтому иконки статус-бара нужны светлые. Аннотация
    // лежит глубже общей из main.dart и потому перебивает её, пока
    // заставка на экране.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarBrightness: Brightness.dark,
        statusBarIconBrightness: Brightness.light,
        statusBarColor: Colors.transparent,
      ),
      child: ColoredBox(
        color: Colors.black,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 34),
            child: AnimatedBuilder(
              animation: _c,
              builder: (_, _) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _word(
                    'assets/branding/word-pizz.png',
                    _angle(_c.value, reverse: false),
                  ),
                  const SizedBox(height: 14),
                  _word(
                    'assets/branding/word-burg.png',
                    _angle(_c.value, reverse: true),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _word(String asset, double angle) => Transform(
    alignment: Alignment.center,
    // setEntry(3, 2, …) — перспектива: без неё поворот по Y выглядит
    // простым сжатием по горизонтали, без объёма.
    transform: Matrix4.identity()
      ..setEntry(3, 2, 0.0011)
      ..rotateY(angle),
    child: Image.asset(asset, fit: BoxFit.fitWidth),
  );
}

enum _Tick { scroll, soft, hard }
