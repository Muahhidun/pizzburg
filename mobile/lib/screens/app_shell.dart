import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
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
/// **Табло из вкладок не делаем.** В старом приложении они разом служили
/// навигацией и сводкой («1006 баллов», «5050 ₸») — хендофф называет это
/// прямой ошибкой: вкладка перестаёт быть местом, куда идёшь. Сумма есть
/// ровно у одной вкладки и ровно тогда, когда в корзине что-то лежит: это
/// не показание счётчика, а состояние действия, которое ждёт завершения.
/// Отдельная плавающая плашка над баром за это же отвечать перестала —
/// две панели внизу перекрывали друг друга и спорили за одно действие.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  int _index = 0;

  /// По контроллеру на вкладку: прокрутка каждой живёт своей жизнью, иначе
  /// переход между вкладками сбрасывал бы позицию соседней.
  /// Куда летит товар при добавлении: слот корзины внутри бара
  final _cartSlotKey = GlobalKey();

  late final List<ScrollController> _scrolls = List.generate(
    _tabs.length,
    (_) => ScrollController(),
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final c in _scrolls) {
      c.dispose();
    }
    super.dispose();
  }

  /// Тап по статус-бару — системный жест iOS «вернуться наверх». Flutter
  /// доводит его сюда сам, но только до наблюдателя привязки: своей
  /// реализации у виджетов нет.
  @override
  void handleStatusBarTap() => _scrollToTop(_index);

  void _scrollToTop(int index) {
    final controller = _scrolls[index];
    if (!controller.hasClients || controller.offset <= 0) return;
    Haptics.tap();
    controller.animateTo(0, duration: Motion.page, curve: Motion.enter);
  }

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

  /// Повторный тап по своей вкладке не переключает экран, а возвращает его
  /// наверх — так ведут себя системные табы iOS и все крупные приложения.
  void _go(int index) {
    if (index == _index) {
      _scrollToTop(index);
      return;
    }
    setState(() => _index = index);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Scaffold(
      backgroundColor: colors.page,
      // Бар должен лежать поверх контента, а не отрезать ему низ, поэтому
      // Stack, а не bottomNavigationBar.
      body: CartFlightTarget(
        slotKey: _cartSlotKey,
        child: Stack(
          children: [
            IndexedStack(
              index: _index,
              children: [
                // Каталогу контроллер нужен и самому — по нему считаются
                // якоря категорий, — поэтому он приходит параметром. Остальные
                // экраны подхватывают свой из PrimaryScrollController: их
                // списки без своего контроллера считаются главными.
                MenuScreen(controller: _scrolls[0]),
                PrimaryScrollController(
                  controller: _scrolls[1],
                  child: FavoritesScreen(onOpenMenu: () => _go(0)),
                ),
                PrimaryScrollController(
                  controller: _scrolls[2],
                  child: const CartScreen(embedded: true),
                ),
                PrimaryScrollController(
                  controller: _scrolls[3],
                  child: const OrdersScreen(),
                ),
                PrimaryScrollController(
                  controller: _scrolls[4],
                  child: const ProfileScreen(),
                ),
              ],
            ),
            Align(
              alignment: Alignment.bottomCenter,
              child: Consumer<Cart>(
                builder: (_, cart, _) => GlassNavBar(
                  items: _tabs,
                  index: _index,
                  onChanged: _go,
                  cartIndex: 2,
                  cartTotal: cart.subtotal,
                  cartCount: cart.count,
                  cartSlotKey: _cartSlotKey,
                ),
              ),
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
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: 20),
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
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 14,
                ),
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
