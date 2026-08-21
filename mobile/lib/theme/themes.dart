import 'package:flutter/material.dart';

/// Оформление на выбор человека.
///
/// Названия — по цвету, а не по адресату. «Детская», «для девушек» и
/// прочее сужает выбор там, где сужать нечего: взрослому может нравиться
/// яркое, брутальному человеку — мягкое, и подпись под кружком не должна
/// объяснять ему, что он выбрал не своё.
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
    name: 'Базовая',
    hint: 'Чернила, кобальт, лайм',
    ink: Color(0xFF0B0B14),
    accent: Color(0xFF2B3BEE),
    benefit: Color(0xFFD6F84C),
    surface: Color(0xFFFFFFFF),
  ),
  AppThemeVariant(
    id: 'ember',
    name: 'Оранжевая',
    hint: 'Оранжевый, как на вывеске',
    ink: Color(0xFF22140C),
    accent: Color(0xFFDD5B0C),
    benefit: Color(0xFFD6F84C),
    surface: Color(0xFFFFFCF8),
  ),
  AppThemeVariant(
    id: 'olive',
    name: 'Оливковая',
    hint: 'Приглушённая, без ярких пятен',
    ink: Color(0xFF1E2116),
    accent: Color(0xFF5C6B3C),
    benefit: Color(0xFFDCE3A8),
    surface: Color(0xFFFAFAF3),
  ),
];


AppThemeVariant themeById(String? id) => appThemes.firstWhere(
  (t) => t.id == id,
  orElse: () => appThemes.first,
);
