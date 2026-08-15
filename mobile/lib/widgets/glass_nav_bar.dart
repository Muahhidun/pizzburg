import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';

class NavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;

  const NavItem({
    required this.icon,
    IconData? activeIcon,
    required this.label,
  }) : activeIcon = activeIcon ?? icon;
}

/// Плавающий стеклянный таб-бар.
///
/// Не приклеен к нижнему краю, а висит над контентом капсулой: содержимое
/// просвечивает сквозь него и подсказывает, что список продолжается. Это
/// и есть смысл «стекла» — не эффект ради эффекта, а слой, который не
/// отрезает нижнюю часть экрана.
///
/// Что делает его именно «жидким»: подсветка активной вкладки не
/// перерисовывается на новом месте, а **переезжает** к нему. Глаз следит
/// за движением и не теряет, где он оказался.
///
/// Счётчиков на вкладках нет намеренно — в старом приложении они
/// превращали навигацию в табло (см. `docs/DESIGN_SYSTEM.md`).
class GlassNavBar extends StatelessWidget {
  final List<NavItem> items;
  final int index;
  final ValueChanged<int> onChanged;

  const GlassNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        Gap.lg,
        0,
        Gap.lg,
        // На iPhone с домашней полоской хватает зазора над ней, без неё
        // бар иначе прилипает к самому краю экрана.
        math.max(MediaQuery.paddingOf(context).bottom + Gap.sm, Gap.lg),
      ),
      child: ClipRRect(
        borderRadius: R.pill,
        child: BackdropFilter(
          // Размытие делает бар стеклом, а не полупрозрачной плашкой:
          // без него просвечивающий текст читается сквозь панель и мешает.
          filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            decoration: BoxDecoration(
              color: c.surface.withValues(alpha: 0.72),
              borderRadius: R.pill,
              border: Border.all(
                color: c.surface.withValues(alpha: 0.65),
                width: 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: c.ink.withValues(alpha: 0.10),
                  blurRadius: 24,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final slot = constraints.maxWidth / items.length;
                return Stack(
                  children: [
                    // Подсветка активной вкладки: переезжает, а не мигает
                    AnimatedPositioned(
                      duration: Motion.base,
                      curve: Motion.benefit,
                      left: slot * index,
                      top: 6,
                      bottom: 6,
                      width: slot,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Container(
                          decoration: BoxDecoration(
                            color: c.accentSoft,
                            borderRadius: R.pill,
                          ),
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        for (var i = 0; i < items.length; i++)
                          Expanded(
                            child: _Tab(
                              item: items[i],
                              active: index == i,
                              onTap: () {
                                if (index == i) return;
                                Haptics.selection();
                                onChanged(i);
                              },
                            ),
                          ),
                      ],
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final NavItem item;
  final bool active;
  final VoidCallback onTap;

  const _Tab({required this.item, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = active ? c.accent : c.muted;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        height: Gap.navBar,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedScale(
              scale: active ? 1.1 : 1,
              duration: Motion.base,
              curve: Motion.benefit,
              child: Icon(
                active ? item.activeIcon : item.icon,
                size: 21,
                color: color,
              ),
            ),
            const SizedBox(height: 3),
            AnimatedDefaultTextStyle(
              duration: Motion.base,
              style: TextStyle(
                fontFamily: 'Golos Text',
                fontSize: 11,
                height: 1,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
              // Пять вкладок вместо четырёх: «Избранное» — самое длинное
              // слово, и на узком экране его нужно ужать, а не обрезать.
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(item.label, maxLines: 1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
