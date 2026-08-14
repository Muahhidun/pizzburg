import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'cart_screen.dart';
import 'menu_screen.dart';
import 'orders_screen.dart';
import 'profile_screen.dart';

/// Оболочка с таб-баром: Меню / Корзина / Заказы / Профиль.
///
/// **Счётчиков суммы и баллов в табах нет намеренно.** В старом приложении
/// вкладки одновременно служили навигацией и табло («1006 баллов»,
/// «5050 ₸») — хендофф называет это прямой ошибкой: вкладка перестаёт быть
/// местом, куда идёшь, и становится строкой, которую читаешь.
///
/// Наполненность корзины показывает плавающая кнопка на каталоге, а не таб.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  static const _tabs = [
    (icon: Icons.grid_view_rounded, label: 'Меню'),
    (icon: Icons.shopping_bag_outlined, label: 'Корзина'),
    (icon: Icons.receipt_long_outlined, label: 'Заказы'),
    (icon: Icons.person_outline, label: 'Профиль'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Scaffold(
      backgroundColor: colors.surface,
      body: IndexedStack(
        index: _index,
        children: const [
          MenuScreen(),
          CartScreen(embedded: true),
          OrdersScreen(),
          ProfileScreen(),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(top: BorderSide(color: colors.line)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.only(top: 10, bottom: 8),
            child: Row(
              children: [
                for (var i = 0; i < _tabs.length; i++)
                  Expanded(
                    child: _Tab(
                      icon: _tabs[i].icon,
                      label: _tabs[i].label,
                      active: _index == i,
                      onTap: () {
                        if (_index == i) return;
                        Haptics.selection();
                        setState(() => _index = i);
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _Tab({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = active ? c.accent : c.muted;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        height: 46,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedScale(
              scale: active ? 1.08 : 1,
              duration: Motion.base,
              curve: Motion.change,
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(height: 3),
            AnimatedDefaultTextStyle(
              duration: Motion.base,
              style: TextStyle(
                fontFamily: 'Golos Text',
                fontSize: 10.5,
                height: 1,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
              child: Text(label),
            ),
          ],
        ),
      ),
    );
  }
}

/// Пустая корзина по хендоффу: не «тупик», а предложение повторить.
class EmptyCart extends StatelessWidget {
  final Widget? repeatBlock;
  final VoidCallback onOpenMenu;

  const EmptyCart({super.key, required this.onOpenMenu, this.repeatBlock});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Gap.blockWide),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                color: c.accentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.shopping_bag_outlined,
                size: 34,
                color: c.accent,
              ),
            ),
            const SizedBox(height: Gap.block),
            Text(
              'Пока пусто',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 19),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              'Можно повторить прошлый заказ — это быстрее всего',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (repeatBlock != null) ...[
              const SizedBox(height: Gap.blockWide),
              repeatBlock!,
            ],
            const SizedBox(height: Gap.lg),
            PressScale(
              onTap: onOpenMenu,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                decoration: BoxDecoration(
                  color: c.fillSoft,
                  borderRadius: R.pill,
                ),
                child: Text(
                  'Открыть меню',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: c.ink,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
