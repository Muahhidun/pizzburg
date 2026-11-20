import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/store_review.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/desktop_bar.dart';
import '../widgets/glass_nav_bar.dart';
import '../widgets/motion.dart';
import '../widgets/push_prompt.dart';
import 'cart_screen.dart';
import 'favorites_screen.dart';
import 'menu_screen.dart';
import 'orders_screen.dart';
import 'profile_screen.dart';
import '../i18n/strings.dart';
import '../widgets/app_route.dart';

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

  /// Вкладка, на которую вернуться из экрана заказа.
  ///
  /// После оформления корзина пуста, а оболочка под экраном заказа
  /// оставалась на ней: «назад» вёл в пустую корзину. Оформление, оплата
  /// и пуш об оплате ставят сюда «Меню».
  static final ValueNotifier<int?> jump = ValueNotifier<int?>(null);

  /// Под экраном заказа — меню, а не опустевшая корзина
  static void showMenu() => jump.value = 0;

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
    AppShell.jump.addListener(_onJump);
    _onJump();
    _auth = context.read<AuthState>()..addListener(_maybeAskReview);
    _maybeAskReview();
    // Первый запуск: объясняем, зачем уведомления. С паузой — сначала
    // человек должен увидеть меню, а не окно поверх заставки.
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) PushPrompt.maybeShowIntro(context);
    });
  }

  late final AuthState _auth;

  /// Просьба оценить — когда профиль обновился (вход, возврат в
  /// приложение, вкладка «Заказы»). С паузой: окно не должно выскакивать
  /// в ту же секунду, когда человек что-то нажал.
  void _maybeAskReview() {
    if (!_auth.isAuthenticated) return;
    final orders = _auth.orders;
    Future.delayed(const Duration(seconds: 4), () {
      if (mounted) StoreReview.maybeAsk(orders);
    });
  }

  void _onJump() {
    final index = AppShell.jump.value;
    if (index == null) return;
    AppShell.jump.value = null;
    if (mounted && index != _index) setState(() => _index = index);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    AppShell.jump.removeListener(_onJump);
    _auth.removeListener(_maybeAskReview);
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

  /// Не const: подписи вкладок зависят от выбранного языка, и при
  /// переключении список должен собраться заново.
  static List<NavItem> get _tabs => [
    NavItem(icon: Icons.grid_view_rounded, label: S.tabMenu),
    NavItem(
      icon: Icons.favorite_border,
      activeIcon: Icons.favorite,
      label: S.tabFavorites,
    ),
    NavItem(
      icon: Icons.shopping_bag_outlined,
      activeIcon: Icons.shopping_bag,
      label: S.tabCart,
    ),
    NavItem(icon: Icons.receipt_long_outlined, label: S.tabOrders),
    NavItem(icon: Icons.person_outline, label: S.tabProfile),
  ];

  /// Повторный тап по своей вкладке не переключает экран, а возвращает его
  /// наверх — так ведут себя системные табы iOS и все крупные приложения.
  void _go(int index) {
    // `IndexedStack` сохраняет экраны вместе с их состоянием. Это удобно для
    // прокрутки, но профиль с историей заказов сам по себе не перечитывался:
    // после отмены карточка NEW висела до ручного pull-to-refresh. Поэтому
    // каждый вход в «Заказы» сверяет историю с сервером, включая повторный
    // тап по уже открытой вкладке.
    if (index == 3) {
      final auth = context.read<AuthState>();
      if (auth.isAuthenticated) {
        unawaited(auth.refresh().catchError((_) {}));
      }
    }
    if (index == _index) {
      _scrollToTop(index);
      return;
    }
    setState(() => _index = index);
  }

  /// Компьютер: шапка сверху, корзина живёт панелью справа от меню.
  ///
  /// Отдельной вкладки корзины здесь нет: второй экземпляр корзины в
  /// стеке вкладок пересчитывал бы её на сервере параллельно с панелью.
  Widget _desktop(BuildContext context) {
    final colors = context.colors;
    // Вкладка корзины могла остаться выбранной на узком окне
    final index = _index == 2 ? 0 : _index;
    return Scaffold(
      backgroundColor: colors.page,
      body: CartFlightTarget(
        slotKey: _cartSlotKey,
        child: Column(
          children: [
            Consumer<Cart>(
              builder: (_, cart, _) => DesktopTopBar(
                items: [
                  (index: 0, label: S.tabMenu),
                  (index: 1, label: S.tabFavorites),
                  (index: 3, label: S.tabOrders),
                  (index: 4, label: S.tabProfile),
                ],
                index: index,
                onChanged: _go,
                onCart: () => _go(0),
                cartTotal: cart.subtotal,
                cartCount: cart.count,
                cartSlotKey: _cartSlotKey,
              ),
            ),
            Expanded(
              child: IndexedStack(
                index: index,
                children: [
                  MenuScreen(controller: _scrolls[0]),
                  PrimaryScrollController(
                    controller: _scrolls[1],
                    child: NarrowColumn(
                      maxWidth: 900,
                      backdrop: colors.page,
                      child: FavoritesScreen(onOpenMenu: () => _go(0)),
                    ),
                  ),
                  const SizedBox.shrink(),
                  PrimaryScrollController(
                    controller: _scrolls[3],
                    child: NarrowColumn(
                      maxWidth: 760,
                      backdrop: colors.page,
                      child: const OrdersScreen(),
                    ),
                  ),
                  PrimaryScrollController(
                    controller: _scrolls[4],
                    child: NarrowColumn(
                      maxWidth: 760,
                      backdrop: colors.page,
                      child: const ProfileScreen(),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    if (WideLayout.of(context)) return _desktop(context);

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
                  child: NarrowColumn(
                    child: FavoritesScreen(onOpenMenu: () => _go(0)),
                  ),
                ),
                PrimaryScrollController(
                  controller: _scrolls[2],
                  child: NarrowColumn(child: const CartScreen(embedded: true)),
                ),
                PrimaryScrollController(
                  controller: _scrolls[3],
                  child: NarrowColumn(child: const OrdersScreen()),
                ),
                PrimaryScrollController(
                  controller: _scrolls[4],
                  child: NarrowColumn(child: const ProfileScreen()),
                ),
              ],
            ),
            Align(
              alignment: Alignment.bottomCenter,
              // На широком окне бар остаётся телефонного размера по центру,
              // а не растягивается на весь монитор
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: kNarrowMaxWidth),
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
              S.cartEmpty,
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: 20),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              S.cartEmptyHint,
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
                  S.openMenu,
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
