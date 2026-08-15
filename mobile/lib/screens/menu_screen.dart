import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import '../state/favorites.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import '../widgets/repeat_order_card.dart';
import 'cart_screen.dart';
import 'catalog_header.dart';
import 'catalog_parts.dart';
import 'order_screen.dart';
import 'product_screen.dart';

/// Каталог — главный экран.
///
/// Категории работают якорями непрерывного скролла, а не фильтром: так
/// человек видит всё меню и может листать, а чипсы лишь подсказывают, где
/// он сейчас. Хендофф прямо рекомендует этот вариант.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

/// Всё, что нужно каталогу за один заход
class _CatalogData {
  final MenuResponse menu;
  final Availability availability;
  final LastOrder? lastOrder;
  final List<SavedAddress> addresses;

  /// Заказ, который прямо сейчас готовится или едет
  final Map<String, dynamic>? activeOrder;

  const _CatalogData({
    required this.menu,
    required this.availability,
    this.lastOrder,
    this.addresses = const [],
    this.activeOrder,
  });
}

const _activeStatuses = {'NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'};

const _stageLabels = {
  'NEW': 'Отправлен на кухню',
  'ACCEPTED': 'Принят кухней',
  'COOKING': 'Готовим ваш заказ',
  'READY': 'Готов',
  'ON_WAY': 'Курьер в пути',
};

sealed class _Row {
  const _Row();
}

class _HeaderRow extends _Row {
  final String categoryId;
  final String title;
  const _HeaderRow(this.categoryId, this.title);
}

class _ProductRowItem extends _Row {
  final String categoryId;
  final Product product;
  const _ProductRowItem(this.categoryId, this.product);
}

const _categoryTitleHeight = 58.0;
const _productRowHeight = 101.0;

class _MenuScreenState extends State<MenuScreen> {
  late Future<_CatalogData> _future;
  final _listController = ScrollController();

  /// На сколько список оттянут вниз за свой верх, px.
  ///
  /// При оттягивании CustomScrollView открывает то, что под ним, а под ним
  /// белый Scaffold — и из-под чёрного хедера выезжает белая полоса.
  /// Закрываем ровно образовавшуюся щель: её высота и есть перетяг.
  /// Прямоугольник фиксированной высоты тут не годится — прокрученный
  /// список прозрачен, и чёрное просвечивало бы между строк.
  final _overscroll = ValueNotifier<double>(0);
  final _chipsController = ScrollController();

  final List<_Row> _rows = [];
  final Map<String, double> _offsets = {};
  List<MenuCategory> _categories = [];
  String? _activeCategory;
  bool _programmaticScroll = false;
  String _mode = 'DELIVERY';
  int _attempt = 1;
  MenuResponse? _menu;
  final _search = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
    _listController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _overscroll.dispose();
    _listController.dispose();
    _chipsController.dispose();
    _search.dispose();
    super.dispose();
  }

  /// Ищем и по названию, и по составу: человек чаще помнит «с халапеньо»,
  /// чем точное имя блюда.
  List<Product> _found(MenuResponse menu) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return const [];
    return [
      for (final category in menu.categories)
        for (final product in category.products)
          if (product.name.toLowerCase().contains(q) ||
              product.description.toLowerCase().contains(q))
            product,
    ];
  }

  Future<_CatalogData> _load() async {
    final api = context.read<ApiClient>();
    final authed = context.read<AuthState>().isAuthenticated;

    // Меню и режим — обязательные; повтор и адреса нужны только вошедшим
    // и не должны ронять экран, если не пришли.
    final menu = await api.fetchMenu();
    final availability = await api.fetchAvailability();
    LastOrder? last;
    List<SavedAddress> addresses = const [];
    if (authed) {
      try {
        last = await api.fetchLastOrder();
        addresses = await api.fetchAddresses();
      } catch (_) {
        // блок повтора просто не покажем
      }
    }
    // Активный заказ ищем и для гостя: id последнего заказа сохранён на
    // устройстве, иначе после оформления вернуться к статусу было бы нельзя.
    Map<String, dynamic>? active;
    final remembered = await LastPlacedOrder.restore();
    if (remembered != null) {
      try {
        final status = await api.orderStatus(remembered.$1);
        if (_activeStatuses.contains(status['status']?.toString())) {
          active = status;
        } else {
          await LastPlacedOrder.forget();
        }
      } catch (_) {
        // заказ мог быть удалён — блок просто не покажем
      }
    }

    _menu = menu;
    if (!availability.deliveryAvailable) _mode = 'PICKUP';
    return _CatalogData(
      menu: menu,
      availability: availability,
      lastOrder: last,
      addresses: addresses,
      activeOrder: active,
    );
  }

  void _retry() {
    setState(() {
      _attempt++;
      _rows.clear();
      _offsets.clear();
      _future = _load();
    });
  }

  void _buildRows(MenuResponse menu) {
    if (_rows.isNotEmpty) return;
    _categories = menu.categories;
    var offset = 0.0;
    for (final category in menu.categories) {
      _offsets[category.id] = offset;
      _rows.add(_HeaderRow(category.id, category.name));
      offset += _categoryTitleHeight;
      for (final product in category.products) {
        _rows.add(_ProductRowItem(category.id, product));
        offset += _productRowHeight;
      }
    }
    _activeCategory = menu.categories.isEmpty ? null : menu.categories.first.id;
  }

  void _onScroll() {
    _overscroll.value = math.max(0, -_listController.offset);
    if (_programmaticScroll || _categories.isEmpty) return;
    final offset = _listController.offset + 1;
    var current = _categories.first.id;
    for (final category in _categories) {
      if ((_offsets[category.id] ?? 0) <= offset) {
        current = category.id;
      } else {
        break;
      }
    }
    if (current != _activeCategory) {
      setState(() => _activeCategory = current);
      _scrollChipsTo(current);
    }
  }

  void _scrollChipsTo(String categoryId) {
    final index = _categories.indexWhere((c) => c.id == categoryId);
    if (index < 0 || !_chipsController.hasClients) return;
    _chipsController.animateTo(
      (index * 110.0 - 60).clamp(0.0, _chipsController.position.maxScrollExtent),
      duration: Motion.base,
      curve: Motion.change,
    );
  }

  Future<void> _jumpToCategory(String categoryId) async {
    final offset = _offsets[categoryId];
    if (offset == null || !_listController.hasClients) return;
    setState(() {
      _activeCategory = categoryId;
      _programmaticScroll = true;
    });
    _scrollChipsTo(categoryId);
    await _listController.animateTo(
      offset.clamp(0.0, _listController.position.maxScrollExtent),
      duration: Motion.page,
      curve: Motion.enter,
    );
    _programmaticScroll = false;
  }

  /// Подпись справа в шапке.
  ///
  /// Времени доставки бэкенд пока не считает, а выдуманные «35 мин» — прямой
  /// путь к скандалу: человек оформит предзаказ на через час и предъявит
  /// цифру из шапки. Поэтому показываем то, что знаем точно, — режим
  /// получения и часы работы, а не обещание срока.
  String _eta(Availability a) {
    if (!a.isOpenNow) return 'закрыто';
    if (_mode == 'PICKUP') return 'самовывоз';
    if (!a.deliveryAvailable) return 'только самовывоз';
    final hours = a.todayHours;
    if (hours.isNotEmpty && hours.first.length == 2) {
      return 'до ${hours.first[1]}';
    }
    return 'доставка';
  }

  String _addressLabel(_CatalogData data) {
    if (_mode == 'PICKUP') return 'Ауэзова 47б, MaxiMall';
    if (data.addresses.isEmpty) return 'Укажите адрес';
    final a = data.addresses.first;
    return '${a.street}, ${a.house}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Сердечки показываем только вошедшим: избранное хранится на сервере,
    // и гостю кнопка обещала бы сохранение, которого не будет.
    final favorites = context.watch<Favorites>();
    final authed = context.watch<AuthState>().isAuthenticated;
    return Scaffold(
      backgroundColor: colors.surface,
      body: FutureBuilder<_CatalogData>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SafeArea(top: false, child: CatalogSkeleton());
          }
          if (snapshot.hasError) {
            return SafeArea(
              child: CatalogError(
                message: snapshot.error.toString(),
                attempt: _attempt,
                onRetry: _retry,
              ),
            );
          }

          final data = snapshot.data!;
          _buildRows(data.menu);

          // top: false — хедер сам заходит под статус-бар и красит его
          return SafeArea(
            top: false,
            bottom: false,
            child: Stack(
              children: [
                // Чёрное «дно» под хедером: видно только когда список
                // оттянут вниз. Иначе из-под хедера выезжает белый Scaffold.
                ValueListenableBuilder<double>(
                  valueListenable: _overscroll,
                  builder: (context, gap, _) => Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: gap,
                    child: ColoredBox(color: colors.ink),
                  ),
                ),
                CustomScrollView(
                  controller: _listController,
                  slivers: [
                    SliverToBoxAdapter(
                      child: CatalogHeader(
                        addressLabel: _addressLabel(data),
                        etaLabel: _eta(data.availability),
                        mode: _mode,
                        availability: data.availability,
                        onModeChanged: (m) => setState(() => _mode = m),
                        activeOrderBlock: data.activeOrder == null
                            ? null
                            : _ActiveOrderCard(
                                order: data.activeOrder!,
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => OrderScreen(
                                      order: CreatedOrder(
                                        id: data.activeOrder!['id'].toString(),
                                        number:
                                            (data.activeOrder!['number'] as num)
                                                .toInt(),
                                        total:
                                            (data.activeOrder!['total'] as num?)
                                                    ?.toInt() ??
                                                0,
                                        pointsSpent: 0,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                        // Блок повтора прячем, когда заведение закрыто:
                        // предлагать действие, которое сейчас не выполнить,
                        // хуже, чем не предлагать.
                        repeatBlock:
                            data.lastOrder != null && data.availability.isOpenNow
                                ? RepeatOrderCard(
                                    order: data.lastOrder!,
                                    menu: _menu,
                                    onDark: true,
                                    onRepeated: _openCart,
                                  )
                                : null,
                      ),
                    ),
                    // Переключатель на белом фоне, как в прототипе: внутри
                    // тёмного хедера выбранная половина сливалась с фоном.
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          Gap.screen,
                          Gap.block,
                          Gap.screen,
                          0,
                        ),
                        child: ModeSwitch(
                          mode: _mode,
                          deliveryAvailable:
                              data.availability.deliveryAvailable,
                          onChanged: (m) => setState(() => _mode = m),
                        ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          Gap.screen,
                          Gap.md,
                          Gap.screen,
                          0,
                        ),
                        child: MenuSearch(
                          controller: _search,
                          onChanged: (v) => setState(() => _query = v),
                          onClear: () => setState(() {
                            _search.clear();
                            _query = '';
                          }),
                        ),
                      ),
                    ),
                    // Пока идёт поиск, категории не нужны: они относятся
                    // к полному меню, а не к результатам.
                    if (_query.trim().isEmpty)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.only(top: Gap.lg),
                        child: CategoryChips(
                          categories: _categories,
                          activeId: _activeCategory,
                          controller: _chipsController,
                          onTap: _jumpToCategory,
                        ),
                      ),
                    ),
                    if (_query.trim().isNotEmpty)
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          Gap.screen,
                          Gap.md,
                          Gap.screen,
                          _bottomSpace(context),
                        ),
                        sliver: Builder(
                          builder: (context) {
                            final found = _found(data.menu);
                            if (found.isEmpty) {
                              return SliverToBoxAdapter(
                                child: SearchEmpty(
                                  query: _query.trim(),
                                  onClear: () => setState(() {
                                    _search.clear();
                                    _query = '';
                                  }),
                                ),
                              );
                            }
                            return SliverList.builder(
                              itemCount: found.length,
                              itemBuilder: (context, index) {
                                final product = found[index];
                                return SizedBox(
                                  height: _productRowHeight,
                                  child: Consumer<Cart>(
                                    builder: (context, cart, _) => ProductRow(
                                      product: product,
                                      favorite: authed ? favorites.contains(product.id) : null,
                                      onToggleFavorite: () =>
                                          _toggleFavorite(product.id),
                                      inCart: cart.qtyOf(product),
                                      onRemove: () =>
                                          cart.decrementProduct(product),
                                      onTap: () => Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              ProductScreen(product: product),
                                        ),
                                      ),
                                      onAdd: () {
                                        if (product.hasChoices) {
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => ProductScreen(
                                                product: product,
                                              ),
                                            ),
                                          );
                                          return;
                                        }
                                        cart.add(product);
                                      },
                                    ),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                      )
                    else
                    SliverPadding(
                      padding: EdgeInsets.fromLTRB(
                        Gap.screen,
                        Gap.sm,
                        Gap.screen,
                        _bottomSpace(context),
                      ),
                      sliver: SliverList.builder(
                        itemCount: _rows.length,
                        itemBuilder: (context, index) {
                          final row = _rows[index];
                          if (row is _HeaderRow) {
                            return SizedBox(
                              height: _categoryTitleHeight,
                              child: Align(
                                alignment: Alignment.bottomLeft,
                                child: Padding(
                                  padding: const EdgeInsets.only(bottom: Gap.md),
                                  child: Text(
                                    row.title,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.headlineMedium,
                                  ),
                                ),
                              ),
                            );
                          }
                          final product = (row as _ProductRowItem).product;
                          return StaggeredEntrance(
                            index: index,
                            child: SizedBox(
                              height: _productRowHeight,
                              child: Consumer<Cart>(
                                builder: (context, cart, _) => ProductRow(
                                favorite: authed ? favorites.contains(product.id) : null,
                                onToggleFavorite: () =>
                                    _toggleFavorite(product.id),
                                inCart: cart.qtyOf(product),
                                onRemove: () =>
                                    cart.decrementProduct(product),
                                product: product,
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => ProductScreen(product: product),
                                  ),
                                ),
                                onAdd: () {
                                  // Товар с выбором нельзя добавить одним
                                  // тапом: сначала нужно собрать состав.
                                  if (product.hasChoices) {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) =>
                                            ProductScreen(product: product),
                                      ),
                                    );
                                    return;
                                  }
                                  context.read<Cart>().add(product);
                                },
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
                Positioned(
                  left: Gap.screen,
                  right: Gap.screen,
                  bottom: Gap.navBarSpace(context) - Gap.sm,
                  child: Consumer<Cart>(
                    builder: (_, cart, _) => FloatingCart(
                      total: cart.subtotal,
                      count: cart.count,
                      onTap: _openCart,
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// Ошибку показываем, но состояние не откатываем руками: этим занимается
  /// сам `Favorites`, иначе сердце дважды дёрнется.
  Future<void> _toggleFavorite(String productId) async {
    try {
      await context.read<Favorites>().toggle(productId);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Не удалось сохранить — попробуйте ещё раз')),
      );
    }
  }

  /// Низ каталога занят двумя плавающими слоями: стеклянным баром и
  /// кнопкой корзины над ним. Без этого запаса последняя позиция меню
  /// оказывается под ними — и человек решает, что список кончился раньше.
  double _bottomSpace(BuildContext context) =>
      Gap.navBarSpace(context) + 64;

  void _openCart() {
    Haptics.tap();
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const CartScreen()),
    );
  }
}

/// Активный заказ в шапке каталога: статус, номер и сумма одним тапом.
class _ActiveOrderCard extends StatelessWidget {
  final Map<String, dynamic> order;
  final VoidCallback onTap;

  const _ActiveOrderCard({required this.order, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final status = order['status']?.toString() ?? 'NEW';
    return PressScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        padding: const EdgeInsets.all(Gap.lg),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: const BorderRadius.all(Radius.circular(24)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _stageLabels[status] ?? status,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '№ ${order['number']} · ${formatTenge((order['total'] as num?)?.toInt() ?? 0)}',
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, size: 20, color: c.muted),
          ],
        ),
      ),
    );
  }
}
