import 'package:flutter/material.dart';

import '../api/models.dart';
import '../i18n/strings.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import 'app_route.dart';
import 'motion.dart';

/// Пункт шапки: индекс вкладки оболочки и подпись
typedef DesktopNavItem = ({int index, String label});

/// Шапка сайта на компьютере вместо нижнего бара.
///
/// Нижний бар — телефонный приём под большой палец. На мониторе он
/// висел капсулой посреди экрана и закрывал карточки, а привычное место
/// навигации сайта — верх: логотип слева, разделы, корзина справа с
/// суммой.
class DesktopTopBar extends StatelessWidget {
  final List<DesktopNavItem> items;
  final int index;
  final ValueChanged<int> onChanged;
  final VoidCallback onCart;
  final int cartTotal;
  final int cartCount;

  /// Куда летит товар при добавлении — сюда, а не в нижний бар
  final GlobalKey cartSlotKey;

  const DesktopTopBar({
    super.key,
    required this.items,
    required this.index,
    required this.onChanged,
    required this.onCart,
    required this.cartTotal,
    required this.cartCount,
    required this.cartSlotKey,
  });

  static const double height = 72;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: c.page,
        border: Border(bottom: BorderSide(color: c.line)),
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: kAppMaxWidth),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.blockWide),
            child: Row(
              children: [
                _Logo(onTap: () => onChanged(0)),
                const SizedBox(width: 40),
                for (final item in items) ...[
                  _NavLink(
                    label: item.label,
                    active: item.index == index,
                    onTap: () => onChanged(item.index),
                  ),
                  const SizedBox(width: Gap.xs),
                ],
                const Spacer(),
                _CartButton(
                  key: cartSlotKey,
                  total: cartTotal,
                  count: cartCount,
                  onTap: onCart,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Logo extends StatelessWidget {
  final VoidCallback onTap;
  const _Logo({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(11)),
              child: Image.asset(
                'assets/branding/icon-1024.png',
                width: 40,
                height: 40,
              ),
            ),
            const SizedBox(width: Gap.md),
            Text(
              'PizzBurg',
              style: TextStyle(
                fontFamily: 'Unbounded',
                fontSize: 20,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.4,
                color: c.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavLink extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _NavLink({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale.selection(
      onTap: onTap,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: AnimatedContainer(
          duration: Motion.base,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: active ? c.fillSoft : Colors.transparent,
            borderRadius: R.pill,
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: active ? c.ink : c.muted,
            ),
          ),
        ),
      ),
    );
  }
}

/// Корзина в шапке: пустая — просто подпись, с товарами — сумма и счётчик
class _CartButton extends StatelessWidget {
  final int total;
  final int count;
  final VoidCallback onTap;

  const _CartButton({
    super.key,
    required this.total,
    required this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final filled = count > 0;
    return PressScale(
      onTap: onTap,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: AnimatedContainer(
          duration: Motion.base,
          height: 46,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          decoration: BoxDecoration(
            color: filled ? c.accent : c.fillSoft,
            borderRadius: R.pill,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                filled ? Icons.shopping_bag : Icons.shopping_bag_outlined,
                size: 19,
                color: filled ? c.surface : c.ink,
              ),
              const SizedBox(width: 10),
              Text(
                filled ? formatTenge(total) : S.tabCart,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: filled ? c.surface : c.ink,
                ),
              ),
              if (filled) ...[
                const SizedBox(width: 10),
                Container(
                  constraints: const BoxConstraints(minWidth: 24),
                  height: 24,
                  padding: const EdgeInsets.symmetric(horizontal: 7),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: c.benefit,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: c.onBenefit,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
