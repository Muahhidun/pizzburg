import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Линза «жидкого стекла»: преломление фона под виджетом.
///
/// Apple задаёт материалу три свойства — преломлять содержимое под собой,
/// отражать свет вокруг и линзировать по краям. Обычный `BackdropFilter`
/// с размытием даёт только матовость; за остальное отвечает фрагментный
/// шейдер `shaders/liquid_glass.frag`, который читает фон и смещает
/// выборку у кромки линзы.
///
/// **Работает только на Impeller.** `ImageFilter.shader` на Skia и в вебе
/// бросает `UnsupportedError`, поэтому там остаётся обычное размытие —
/// бар выглядит так же, как раньше, и ничего не ломается. Проверять нужно
/// именно `isShaderFilterSupported`, а не платформу: Impeller включают и
/// выключают флагом сборки.
class LiquidGlass {
  LiquidGlass._();

  static ui.FragmentProgram? _program;
  static bool _loading = false;
  static bool _failed = false;

  /// Поддерживает ли текущий бэкенд фильтр на своём шейдере
  static bool get supported =>
      !_failed && ui.ImageFilter.isShaderFilterSupported;

  /// Шейдер готов к использованию
  static bool get ready => _program != null;

  /// Грузим один раз на запуске: компиляция шейдера занимает время, и
  /// делать её в момент первого касания бара — значит подвесить жест.
  static Future<void> warmUp() async {
    if (_program != null || _loading || !supported) return;
    _loading = true;
    try {
      _program = await ui.FragmentProgram.fromAsset(
        'shaders/liquid_glass.frag',
      );
    } catch (error, stack) {
      // Стекло — украшение, а не условие работы приложения: если шейдер
      // не собрался, бар просто останется матовым.
      _failed = true;
      debugPrint('Шейдер стекла не загрузился: $error\n$stack');
    } finally {
      _loading = false;
    }
  }

  /// Фильтр преломления для `BackdropFilter`.
  ///
  /// Размытие сюда НЕ композится намеренно. `ImageFilter.compose` с
  /// размытием внутри расширяет снимок фона на радиус размытия, движок
  /// кладёт в `uSize` размер уже расширенной текстуры — и линза,
  /// посчитанная в долях бара, уезжает к его краю. Проверено на симуляторе:
  /// преломление появлялось у правой кромки вместо выбранной вкладки.
  /// Поэтому размытие вешается отдельным слоем снаружи.
  ///
  /// [center] и [half] задаются в долях от размера бара, [aspect] — его
  /// ширина, делённая на высоту.
  static ui.ImageFilter? filter({
    required Offset center,
    required Size half,
    required double aspect,
    required double strength,
  }) {
    final program = _program;
    if (program == null || !supported) return null;

    final shader = program.fragmentShader();
    // Порядок обязан совпадать с объявлением uniform в .frag: движок
    // кладёт размер текстуры в первые два числа сам, поэтому начинаем с 2.
    shader
      ..setFloat(2, center.dx)
      ..setFloat(3, center.dy)
      ..setFloat(4, half.width)
      ..setFloat(5, half.height)
      ..setFloat(6, aspect)
      ..setFloat(7, strength);

    return ui.ImageFilter.shader(shader);
  }
}
