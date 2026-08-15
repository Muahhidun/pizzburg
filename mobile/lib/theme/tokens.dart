import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Токены направления «Сигнал» из `design_handoff_pizzburg_app/README.md`.
///
/// Правило палитры, которое нельзя нарушать: **чёрный — основа, оранжевый —
/// действия, маджента — выгода.** Больше цветов не вводить. Если новому
/// элементу «нужен свой цвет», это почти всегда значит, что он на самом
/// деле относится к одной из трёх ролей.
///
/// `accent` и `benefit` вынесены в параметры: платформа мультитенантная,
/// и следующее заведение придёт со своими цветами. Ни один экран не должен
/// брать эти цвета константами напрямую — только через тему.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  /// Основной текст и чёрные поверхности: хедер каталога, экран статуса,
  /// тёмный блок баллов в корзине, выбранные сегменты.
  final Color ink;

  /// Все действия: кнопки, «+» в списке, активные чипсы, выбранный адрес.
  final Color accent;

  /// Только выгода: списанные баллы, «0 ₸» у подарка, бейдж «Подарок»,
  /// карточка баллов, галочки пройденных этапов.
  final Color benefit;

  final Color surface;
  final Color muted;

  /// Разделители строк списка и граница таб-бара
  final Color line;

  /// Контур неактивных пилюль и полей ввода
  final Color border;

  /// Фон неактивных чипсов, счётчиков количества, второстепенных кнопок
  final Color fillSoft;

  /// Подложка выбранного адреса, круги в пустых состояниях
  final Color accentSoft;

  /// Фон бейджа подарка (текст на нём — `benefit`)
  final Color benefitSoft;

  /// Фон подсказки «добавьте ещё на N ₸»
  final Color warnSoft;

  /// Текст на `warnSoft`
  final Color warnText;

  const AppColors({
    this.ink = const Color(0xFF0E0D10),
    this.accent = const Color(0xFFF7941D),
    this.benefit = const Color(0xFFE6007E),
    this.surface = const Color(0xFFFFFFFF),
    this.muted = const Color(0xFF8B8792),
    this.line = const Color(0x140E0D10),
    this.border = const Color(0x1F0E0D10),
    this.fillSoft = const Color(0x0D0E0D10),
    this.accentSoft = const Color(0x1AF7941D),
    this.benefitSoft = const Color(0x24F7941D),
    this.warnSoft = const Color(0x1AF7941D),
    this.warnText = const Color(0xFFA96410),
  });

  @override
  AppColors copyWith({Color? ink, Color? accent, Color? benefit}) => AppColors(
    ink: ink ?? this.ink,
    accent: accent ?? this.accent,
    benefit: benefit ?? this.benefit,
    surface: surface,
    muted: muted,
    line: line,
    border: border,
    fillSoft: fillSoft,
    accentSoft: accentSoft,
    benefitSoft: benefitSoft,
    warnSoft: warnSoft,
    warnText: warnText,
  );

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      ink: Color.lerp(ink, other.ink, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      benefit: Color.lerp(benefit, other.benefit, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      border: Color.lerp(border, other.border, t)!,
      fillSoft: Color.lerp(fillSoft, other.fillSoft, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      benefitSoft: Color.lerp(benefitSoft, other.benefitSoft, t)!,
      warnSoft: Color.lerp(warnSoft, other.warnSoft, t)!,
      warnText: Color.lerp(warnText, other.warnText, t)!,
    );
  }
}

/// Отступы. Базовая сетка 4, поля экрана 22.
abstract final class Gap {
  static const double screen = 22;

  /// Между смысловыми блоками
  static const double block = 22;
  static const double blockWide = 24;

  /// Внутри блока
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;

  /// Высота плавающего таб-бара
  static const double navBar = 62;

  /// Сколько нужно оставить внизу прокручиваемого экрана, чтобы плавающий
  /// бар не перекрыл последнюю строку. Считаем от системного отступа, а не
  /// константой: на iPhone с домашней полоской и без неё низ разный.
  static double navBarSpace(BuildContext context) =>
      navBar +
      math.max(MediaQuery.paddingOf(context).bottom + sm, lg) +
      block;
}

/// Радиусы из хендоффа. `pill` — капсула для всего интерактивного.
abstract final class R {
  static const BorderRadius pill = BorderRadius.all(Radius.circular(999));
  static const BorderRadius headerBottom = BorderRadius.only(
    bottomLeft: Radius.circular(30),
    bottomRight: Radius.circular(30),
  );
  static const BorderRadius sheetTop = BorderRadius.only(
    topLeft: Radius.circular(30),
    topRight: Radius.circular(30),
  );

  /// Крупные блоки: баллы, адреса, карточка профиля
  static const BorderRadius block = BorderRadius.all(Radius.circular(28));

  /// Фото товара на карточке
  static const BorderRadius photo = BorderRadius.all(Radius.circular(26));

  /// Миниатюра в списке каталога
  static const BorderRadius thumb = BorderRadius.all(Radius.circular(22));

  /// Миниатюра в корзине
  static const BorderRadius thumbCart = BorderRadius.all(Radius.circular(20));

  /// Миниатюра в блоке повтора
  static const BorderRadius thumbRepeat = BorderRadius.all(Radius.circular(15));

  /// Поля ввода, подсказки, строки адресов
  static const BorderRadius field = BorderRadius.all(Radius.circular(20));
}

/// Минимальная тап-зона. В хендоффе кнопки визуально 34, но касание
/// расширяется до 44 — иначе в «+» на строке товара трудно попасть.
abstract final class Hit {
  static const double min = 44;
}

/// Длительности и кривые движения.
///
/// Хендофф просил обойтись стандартными переходами; движение добавлено
/// отдельным решением владельца. Чтобы оно не превратилось в шум, скорость
/// привязана к смыслу цвета:
/// — `fast` — оранжевое, действие: подтверждение нажатия, счётчик суммы;
/// — `base` — структура: смена состояния, переключатели, переходы экранов;
/// — `slow` — маджентовое, выгода: подарок, списание баллов, пройденный
///   этап. Это единственное место, где движение имеет право быть заметным.
abstract final class Motion {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration base = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 420);
  static const Duration page = Duration(milliseconds: 300);

  /// Появление элементов
  static const Curve enter = Curves.easeOutCubic;

  /// Смена состояния уже видимого элемента
  static const Curve change = Curves.easeInOut;

  /// Выгода: с лёгким перелётом, чтобы момент запоминался
  static const Curve benefit = Curves.easeOutBack;

  /// Шаг каскада при появлении списка
  static const Duration stagger = Duration(milliseconds: 40);
}
