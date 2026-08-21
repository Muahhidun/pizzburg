import 'package:flutter/material.dart';

/// Оформление на выбор человека.
///
/// Тема — это четыре цвета, а не четыре набора экранов: `ink` (текст и
/// тёмные поверхности), `accent` (все действия), `benefit` (только выгода,
/// только заливкой) и `surface` (фон). Всё остальное считается от них в
/// [AppColors]. Поэтому новая тема — это одна строка здесь, а не правка
/// каждого экрана.
///
/// Все темы светлые. Тёмная требует не другой палитры, а другой вёрстки:
/// на экране статуса и в шапке каталога тёмные блоки набираются `surface`
/// поверх `ink`, и при инверсии текст исчез бы. Это отдельная работа.
///
/// Правила, которые нельзя нарушить при добавлении темы:
/// — `accent` держит белый текст, поэтому должен быть тёмным;
/// — `benefit` — заливка с тёмным текстом поверх, поэтому светлым;
/// — `surface` может быть слегка подкрашен, но остаётся почти белым: им
///   же набирается текст поверх тёмных блоков.
@immutable
class AppThemeVariant {
  final String id;
  final String name;

  /// Одной строкой в списке выбора — чтобы не гадать по кружку
  final String hint;

  final Color ink;
  final Color accent;
  final Color benefit;
  final Color surface;

  const AppThemeVariant({
    required this.id,
    required this.name,
    required this.hint,
    required this.ink,
    required this.accent,
    required this.benefit,
    required this.surface,
  });
}

const kDefaultThemeId = 'signal';

const appThemes = <AppThemeVariant>[
  AppThemeVariant(
    id: kDefaultThemeId,
    name: 'Сдержанная',
    hint: 'Как было: чернила, кобальт, лайм',
    ink: Color(0xFF0B0B14),
    accent: Color(0xFF2B3BEE),
    benefit: Color(0xFFD6F84C),
    surface: Color(0xFFFFFFFF),
  ),
  AppThemeVariant(
    id: 'neon',
    name: 'Молодёжная',
    hint: 'Фиолет и кислотный лайм',
    ink: Color(0xFF17122A),
    accent: Color(0xFF6C2BD9),
    benefit: Color(0xFFC8FF4D),
    surface: Color(0xFFFFFFFF),
  ),
  AppThemeVariant(
    id: 'blossom',
    name: 'Нежная',
    hint: 'Розовый и тёплое золото',
    ink: Color(0xFF2E1A24),
    accent: Color(0xFFD63A78),
    benefit: Color(0xFFFFC857),
    surface: Color(0xFFFFF8FA),
  ),
  AppThemeVariant(
    id: 'kids',
    name: 'Детская',
    hint: 'Синий и жёлтый, как в мультике',
    ink: Color(0xFF172A4A),
    accent: Color(0xFF1668E3),
    benefit: Color(0xFFFFD93D),
    surface: Color(0xFFF5FAFF),
  ),
];

AppThemeVariant themeById(String? id) => appThemes.firstWhere(
  (t) => t.id == id,
  orElse: () => appThemes.first,
);
