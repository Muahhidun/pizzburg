import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/glass_nav_bar.dart';
import '../widgets/motion.dart';
import 'cart_screen.dart';
import 'favorites_screen.dart';
import 'menu_screen.dart';
import 'orders_screen.dart';
import 'profile_screen.dart';

/// Оболочка с таб-баром: Меню / Избранное / Корзина / Заказы / Профиль.
///
/// Бар не приклеен к нижнему краю, а висит над контентом капсулой: список
/// уходит под стекло и видно, что он продолжается. Поэтому экраны внутри
/// сами оставляют внизу `Gap.navBarSpace` — иначе последняя строка окажется
/// под баром.
///
/// Корзина стоит по центру: это главное действие, и до центра большой палец
/// достаёт легче, чем до краёв.
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
    NavItem(icon: Icons.grid_view_rounded, label: 'Меню'),
    NavItem(
      icon: Icons.favorite_border,
      activeIcon: Icons.favorite,
      label: 'Избранное',
    ),
    NavItem(
      icon: Icons.shopping_bag_outlined,
      activeIcon: Icons.shopping_bag,
      label: 'Корзина',
    ),
    NavItem(icon: Icons.receipt_long_outlined, label: 'Заказы'),
    NavItem(icon: Icons.person_outline, label: 'Профиль'),
  ];

  void _go(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Scaffold(
      backgroundColor: colors.surface,
      // Бар должен лежать поверх контента, а не отрезать ему низ, поэтому
      // Stack, а не bottomNavigationBar.
      body: Stack(
        children: [
          IndexedStack(
            index: _index,
            children: [
              const MenuScreen(),
              FavoritesScreen(onOpenMenu: () => _go(0)),
              const CartScreen(embedded: true),
              const OrdersScreen(),
              const ProfileScreen(),
            ],
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: GlassNavBar(
              items: _tabs,
              index: _index,
              onChanged: _go,
            ),
          ),
        ],
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
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 20),
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
                    fontSize: 13.5,
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
