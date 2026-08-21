import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
import 'add_address_screen.dart';
import 'product_screen.dart';

/// Каталог — главный экран.
///
/// Категории работают якорями непрерывного скролла, а не фильтром: так
/// человек видит всё меню и может листать, а чипсы лишь подсказывают, где
/// он сейчас. Хендофф прямо рекомендует этот вариант.
class MenuScreen extends StatefulWidget {
  /// Прокрутка каталога. Владелец — оболочка приложения: ей нужно уметь
  /// вернуть список наверх по тапу на активную вкладку и по статус-бару.
  final ScrollController? controller;

  const MenuScreen({super.key, this.controller});

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

/// Высота закреплённой строки категорий: поля по 12 вокруг тап-зоны 44.
const _chipsExtent = Hit.min + Gap.md * 2;
const _categoryTitleHeight = 58.0;
const _productRowHeight = 101.0;

class _MenuScreenState extends State<MenuScreen> {
  late Future<_CatalogData> _future;

  /// Контроллер приходит от оболочки, чтобы она умела возвращать каталог
  /// наверх по тапу на вкладку и по статус-бару. Свой заводим только когда
  /// экран открыт сам по себе — например в тестах.
  ScrollController? _ownedController;
  ScrollController get _listController =>
      widget.controller ?? (_ownedController ??= ScrollController());

  /// На сколько список оттянут вниз за свой верх, px.
  ///
  /// При оттягивании CustomScrollView открывает то, что под ним, а под ним
  /// белый Scaffold — и из-под чёрного хедера выезжает белая полоса.
  /// Закрываем ровно образовавшуюся щель: её высота и есть перетяг.
  /// Прямоугольник фиксированной высоты тут не годится — прокрученный
  /// список прозрачен, и чёрное просвечивало бы между строк.
  final _overscroll = ValueNotifier<double>(0);
  final _chipsController = ScrollController();

  /// Маркер начала списка товаров и его позиция в прокрутке.
  ///
  /// Смещения категорий копятся от нуля, а сам список начинается ниже
  /// шапки, режима и поиска. Высота этого блока не константа — она зависит
  /// от блока повтора и карточки активного заказа, — поэтому измеряем её
  /// по факту, а не считаем.
  final _listAnchorKey = GlobalKey();
  double _listTop = 0;

  /// Строка категорий в потоке и её позиция: как только она уходит под верх
  /// экрана, её подхватывает плавающий островок.
  final _chipsAnchorKey = GlobalKey();
  double _chipsTop = 0;
  bool _chipsFloating = false;

  /// У островка свой контроллер горизонтальной прокрутки: тот же самый
  /// нельзя — один ScrollController не обслуживает два живых списка.
  final _floatingChipsController = ScrollController();

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

  /// Активный заказ держим отдельно от загрузки каталога.
  ///
  /// Каталог живёт в IndexedStack и грузится один раз, а заказ появляется
  /// и меняется уже после: оформили — должна возникнуть карточка, кассир
  /// отметила нехватку — на ней должно появиться «Нужен ваш ответ».
  /// Внутри FutureBuilder этого не видно, потому что запрос не повторяется.
  Map<String, dynamic>? _activeOrder;
  Timer? _activeOrderTimer;

  /// id адреса, выбранного человеком; null — берём первый сохранённый
  String? _selectedAddressId;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _listController.addListener(_onScroll);
    LastPlacedOrder.revision.addListener(_refreshActiveOrder);
    SelectedAddress.revision.addListener(_reloadSelectedAddress);
    _reloadSelectedAddress();
    // Вопрос о нехватке появляется, пока человек уже на главном, и ждать
    // его пять минут молча нельзя — карточка должна успеть измениться.
    _activeOrderTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _refreshActiveOrder(),
    );
  }

  Future<void> _reloadSelectedAddress() async {
    final id = await SelectedAddress.get();
    if (mounted && id != _selectedAddressId) {
      setState(() => _selectedAddressId = id);
    }
  }

  /// Перечитывает активный заказ, не трогая каталог
  Future<void> _refreshActiveOrder() async {
    // Клиента берём до первого await: после него виджет мог уйти с экрана
    final api = context.read<ApiClient>();
    final remembered = await LastPlacedOrder.restore();
    if (remembered == null) {
      if (mounted && _activeOrder != null) setState(() => _activeOrder = null);
      return;
    }
    try {
      final status = await api.orderStatus(remembered.$1);
      if (!mounted) return;
      if (_activeStatuses.contains(status['status']?.toString())) {
        setState(() => _activeOrder = status);
      } else {
        await LastPlacedOrder.forget();
        if (mounted) setState(() => _activeOrder = null);
      }
    } catch (_) {
      // заказ мог быть удалён — оставляем как есть до следующего круга
    }
  }

  @override
  void dispose() {
    LastPlacedOrder.revision.removeListener(_refreshActiveOrder);
    SelectedAddress.revision.removeListener(_reloadSelectedAddress);
    _activeOrderTimer?.cancel();
    _overscroll.dispose();
    // Чужой контроллер не наш, его закроет оболочка
    _listController.removeListener(_onScroll);
    _ownedController?.dispose();
    _chipsController.dispose();
    _floatingChipsController.dispose();
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
    _activeOrder = active;
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

  /// Сколько сверху занято закреплёнными слоями: под ними список не виден,
  /// поэтому и заголовок категории должен вставать ровно под ними.
  /// Низ плавающего островка: под ним список не виден, поэтому заголовок
  /// категории при переходе должен вставать ровно под ним.
  double _pinnedTop() {
    final top = MediaQuery.paddingOf(context).top + Gap.sm;
    if (_query.trim().isNotEmpty) return top;
    return top + Hit.min + Gap.sm * 2 + Gap.md;
  }

  double? _offsetOf(GlobalKey key) {
    final box = key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return null;
    final viewport = RenderAbstractViewport.maybeOf(box);
    if (viewport == null) return null;
    final top = viewport.getOffsetToReveal(box, 0).offset;
    return top.isFinite ? top : null;
  }

  void _measureListTop() {
    final top = _offsetOf(_listAnchorKey);
    if (top != null && (top - _listTop).abs() > 0.5) _listTop = top;
    final chips = _offsetOf(_chipsAnchorKey);
    if (chips != null && (chips - _chipsTop).abs() > 0.5) _chipsTop = chips;
  }

  void _onScroll() {
    _overscroll.value = math.max(0, -_listController.offset);
    if (_programmaticScroll || _categories.isEmpty) return;
    _measureListTop();
    final offset = _listController.offset - _listTop + _pinnedTop() + 1;
    var current = _categories.first.id;
    for (final category in _categories) {
      if ((_offsets[category.id] ?? 0) <= offset) {
        current = category.id;
      } else {
        break;
      }
    }
    // Островок поднимается ровно тогда, когда строка из потока уходит под
    // его собственное место — иначе на экране было бы две одинаковых строки.
    final floating =
        _chipsTop > 0 &&
        _listController.offset > _chipsTop - MediaQuery.paddingOf(context).top;
    if (floating != _chipsFloating) setState(() => _chipsFloating = floating);

    if (current != _activeCategory) {
      setState(() => _activeCategory = current);
      _scrollChipsTo(current);
    }
  }

  void _scrollChipsTo(String categoryId) {
    final index = _categories.indexWhere((c) => c.id == categoryId);
    if (index < 0) return;
    // Обе строки — в потоке и в островке — держим на одной позиции: между
    // ними переключаются прокруткой, и разъехавшиеся якоря сбивали бы.
    for (final controller in [_chipsController, _floatingChipsController]) {
      if (!controller.hasClients) continue;
      controller.animateTo(
        (index * 110.0 - 60).clamp(0.0, controller.position.maxScrollExtent),
        duration: Motion.base,
        curve: Motion.change,
      );
    }
  }

  Future<void> _jumpToCategory(String categoryId) async {
    final offset = _offsets[categoryId];
    if (offset == null || !_listController.hasClients) return;
    setState(() {
      _activeCategory = categoryId;
      _programmaticScroll = true;
    });
    _scrollChipsTo(categoryId);
    _measureListTop();
    await _listController.animateTo(
      (_listTop + offset - _pinnedTop()).clamp(
        0.0,
        _listController.position.maxScrollExtent,
      ),
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
  /// Значок справа от адреса — это **состояние заведения**, а не режим.
  ///
  /// Раньше он подменялся словами «доставка» и «самовывоз», когда сказать
  /// было нечего, и дублировал переключатель под ним: выбран самовывоз —
  /// и в кнопке «Самовывоз», и в значке «самовывоз». Пустая строка значит
  /// «сказать нечего» — тогда значок не рисуем вовсе, а не занимаем место
  /// повтором того, что уже видно.
  String _eta(Availability a) {
    if (!a.isOpenNow) return 'закрыто';
    if (_mode == 'DELIVERY' && !a.deliveryAvailable) return 'только самовывоз';
    final hours = a.todayHours;
    if (hours.isNotEmpty && hours.first.length == 2) {
      return 'до ${hours.first[1]}';
    }
    return '';
  }

  String _addressLabel(_CatalogData data) {
    if (_mode == 'PICKUP') return 'Ауэзова 47б, MaxiMall';
    if (data.addresses.isEmpty) return 'Укажите адрес';
    final chosen = data.addresses.firstWhere(
      (a) => a.id == _selectedAddressId,
      orElse: () => data.addresses.first,
    );
    return '${chosen.street}, ${chosen.house}';
  }

  /// Выбор адреса с главного экрана.
  ///
  /// Здесь и выбор из сохранённых, и добавление нового. Точка входа
  /// вторая — та же есть в оформлении, — и это осознанно: человек,
  /// который первым делом хочет сменить адрес, не должен для этого
  /// набирать корзину. Ввод при этом один и тот же виджет, двух
  /// реализаций нет.
  Future<void> _pickAddress(List<SavedAddress> addresses) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _AddressSheet(
        addresses: addresses,
        selectedId: _selectedAddressId ?? (addresses.isNotEmpty ? addresses.first.id : ''),
      ),
    );
    if (!mounted || picked == null) return;
    if (picked == _addNewAddress) {
      final added = await Navigator.push<bool>(
        context,
        MaterialPageRoute(builder: (_) => const AddAddressScreen()),
      );
      if (added == true) _retry(); // перечитываем список адресов
      return;
    }
    await SelectedAddress.set(picked);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Сердечки показываем только вошедшим: избранное хранится на сервере,
    // и гостю кнопка обещала бы сохранение, которого не будет.
    final favorites = context.watch<Favorites>();
    final authed = context.watch<AuthState>().isAuthenticated;
    return Scaffold(
      backgroundColor: colors.page,
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
                    child: ColoredBox(color: colors.accent),
                  ),
                ),
                CustomScrollView(
                  controller: _listController,
                  slivers: [
                    SliverToBoxAdapter(
                      child: CatalogHeader(
                        addressLabel: _addressLabel(data),
                        onAddressTap: _mode == 'PICKUP'
                            ? null
                            : () => _pickAddress(data.addresses),
                        etaLabel: _eta(data.availability),
                        mode: _mode,
                        availability: data.availability,
                        onModeChanged: (m) => setState(() => _mode = m),
                        deliveryAvailable: data.availability.deliveryAvailable,
                        activeOrderBlock: _activeOrder == null
                            ? null
                            : _ActiveOrderCard(
                                order: _activeOrder!,
                                onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => OrderScreen(
                                      order: CreatedOrder(
                                        id: _activeOrder!['id'].toString(),
                                        number:
                                            (_activeOrder!['number'] as num)
                                                .toInt(),
                                        total:
                                            (_activeOrder!['total'] as num?)
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
                            data.lastOrder != null &&
                                data.availability.isOpenNow
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
                    // Пара кнопок «Доставка / Самовывоз» убрана: она занимала
                    // целую строку и дублировала значок в шапке, где способ
                    // получения теперь и переключается.
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
                        child: SizedBox(
                          key: _chipsAnchorKey,
                          height: _chipsExtent,
                          child: Center(
                            child: CategoryChips(
                              categories: _categories,
                              activeId: _activeCategory,
                              controller: _chipsController,
                              onTap: _jumpToCategory,
                            ),
                          ),
                        ),
                      ),
                    // Нулевой маркер начала списка: от него считаются якоря.
                    // Высоту шапки заранее знать нельзя — она зависит от
                    // блока повтора и активного заказа.
                    SliverToBoxAdapter(
                      child: SizedBox(key: _listAnchorKey, height: 0),
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
                                      inStopList: !product.isAvailable,
                                      favorite: authed
                                          ? favorites.contains(product.id)
                                          : null,
                                      onToggleFavorite: () =>
                                          _toggleFavorite(product.id),
                                      inCart: cart.qtyOf(product),
                                      onRemove: () =>
                                          cart.decrementProduct(product),
                                      onTap: () => Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => ProductScreen(
                                            product: product,
                                            inStopList: !product.isAvailable,
                                          ),
                                        ),
                                      ),
                                      onAdd: () {
                                        if (product.hasChoices) {
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => ProductScreen(
                                                product: product,
                                                inStopList:
                                                    !product.isAvailable,
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
                                    padding: const EdgeInsets.only(
                                      bottom: Gap.md,
                                    ),
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
                                    inStopList: !product.isAvailable,
                                    favorite: authed
                                        ? favorites.contains(product.id)
                                        : null,
                                    onToggleFavorite: () =>
                                        _toggleFavorite(product.id),
                                    inCart: cart.qtyOf(product),
                                    onRemove: () =>
                                        cart.decrementProduct(product),
                                    product: product,
                                    onTap: () => Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => ProductScreen(
                                          product: product,
                                          inStopList: !product.isAvailable,
                                        ),
                                      ),
                                    ),
                                    onAdd: () {
                                      // Товар с выбором нельзя добавить одним
                                      // тапом: сначала нужно собрать состав.
                                      if (product.hasChoices) {
                                        Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (_) => ProductScreen(
                                              product: product,
                                              inStopList: !product.isAvailable,
                                            ),
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
                  top: MediaQuery.paddingOf(context).top + Gap.sm,
                  left: Gap.lg,
                  right: Gap.lg,
                  child: GlassChipsBar(
                    visible: _chipsFloating,
                    child: CategoryChips(
                      categories: _categories,
                      activeId: _activeCategory,
                      controller: _floatingChipsController,
                      onTap: _jumpToCategory,
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
        const SnackBar(
          content: Text('Не удалось сохранить — попробуйте ещё раз'),
        ),
      );
    }
  }

  /// Низ каталога занят стеклянным баром. Отдельной кнопки корзины над ним
  /// больше нет — сумма живёт внутри самого бара, — поэтому запас снизу
  /// стал ровно на её высоту меньше.
  double _bottomSpace(BuildContext context) => Gap.navBarSpace(context);

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
    // Нехватка позиции ждать не может: у человека пять минут на ответ, а
    // пуши на iOS у нас не работают вовсе. Карточка на главном — самый
    // надёжный способ, которым он об этом узнает.
    final needsAnswer = order['shortageState'] == 'AWAITING_CUSTOMER';
    return PressScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        padding: const EdgeInsets.all(Gap.lg),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: const BorderRadius.all(Radius.circular(24)),
          border: needsAnswer ? Border.all(color: c.accent, width: 2) : null,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    needsAnswer
                        ? 'Нужен ваш ответ'
                        : (_stageLabels[status] ?? status),
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: needsAnswer ? c.accent : null,
                    ),
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

/// Служебное значение: в шите выбран пункт «Добавить новый адрес»
const _addNewAddress = '__add__';

/// Выбор адреса доставки с главного экрана.
///
/// Только переключение между сохранёнными: добавление нового живёт в
/// оформлении, где уже есть поиск улицы с подсказками. Две копии одного
/// ввода означали бы две точки отказа и два места, где чинить.
class _AddressSheet extends StatelessWidget {
  final List<SavedAddress> addresses;
  final String selectedId;

  const _AddressSheet({required this.addresses, required this.selectedId});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        Gap.screen,
        Gap.blockWide,
        Gap.screen,
        Gap.blockWide,
      ),
      decoration: BoxDecoration(color: c.page, borderRadius: R.sheetTop),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Куда доставить',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 21),
          ),
          const SizedBox(height: Gap.lg),
          for (final a in addresses)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.sm),
              child: PressScale.selection(
                onTap: () => Navigator.pop(context, a.id),
                child: AnimatedContainer(
                  duration: Motion.base,
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: Gap.lg,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: a.id == selectedId ? c.panel : c.fillSoft,
                    borderRadius: R.field,
                  ),
                  child: Text(
                    [
                      '${a.street}, ${a.house}',
                      if (a.flat.isNotEmpty) 'кв. ${a.flat}',
                    ].join(' · '),
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: a.id == selectedId ? c.surface : c.ink,
                    ),
                  ),
                ),
              ),
            ),
          const SizedBox(height: Gap.sm),
          PressScale(
            onTap: () => Navigator.pop(context, _addNewAddress),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 15),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: R.field,
                border: Border.all(color: c.line),
              ),
              child: Text(
                '+ Добавить новый адрес',
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
    );
  }
}
