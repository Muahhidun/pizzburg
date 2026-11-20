import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Матовое стекло под плавающими панелями: размытие того, что под ними.
///
/// **На сайте размытия нет.** Браузер перерисовывает размытый фон каждый
/// кадр прокрутки, и на iPhone с тройной плотностью пикселей это съедало
/// кадр: список дёргался «желе» — и текст, и фото. Вместо этого панель
/// почти непрозрачная ([frostedAlpha]), читаемость та же.
class Frosted extends StatelessWidget {
  final Widget child;
  const Frosted({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    if (kIsWeb) return child;
    return BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
      child: child,
    );
  }
}

/// Прозрачность заливки панели: в приложении сквозь неё видно размытый
/// список, на сайте размытия нет — и заливка почти сплошная.
double frostedAlpha(double alpha) => kIsWeb ? 0.96 : alpha;
