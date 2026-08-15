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

  /// Фильтр линзы для `BackdropFilter`, натянутой на капсулу-подсветку.
  ///
  /// Линза вешается ПОВЕРХ ряда иконок, а не под ним: снимок фона тогда
  /// содержит сами иконки и подписи, и кромка стекла зримо их гнёт — как
  /// в системном таб-баре iOS 26. Прошлая версия читала фон ЗА баром, а
  /// он почти всегда белый список: преломлять было нечего.
  ///
  /// Всё в физических пикселях снимка (умножайте на devicePixelRatio):
  /// нормированные доли, растянутые на широкий бар, размазывали профиль
  /// кромки горизонтальными полосами.
  static ui.ImageFilter? lensFilter({
    required double thicknessPx,
    double eta = 1.5,
    double chroma = 1.1,
    double light = 0.55,
  }) {
    final program = _program;
    if (program == null || !supported) return null;

    final shader = program.fragmentShader();
    // Порядок обязан совпадать с объявлением uniform в .frag: движок
    // кладёт размер снимка в первые два числа сам, поэтому начинаем с 2.
    shader
      ..setFloat(2, thicknessPx)
      ..setFloat(3, eta)
      ..setFloat(4, chroma)
      ..setFloat(5, light);

    return ui.ImageFilter.shader(shader);
  }
}
