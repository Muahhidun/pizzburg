import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import '../widgets/product_card.dart';
import 'product_screen.dart';
import 'cart_screen.dart';

/// Каталог: липкая лента категорий + список товаров.
///
/// Список плоский, с ФИКСИРОВАННЫМИ высотами строк — поэтому позицию
/// любой категории можно вычислить точно и прокрутить к ней, а при
/// ручной прокрутке — подсветить нужный чип. GlobalKey + ensureVisible
/// здесь не работают: элементы вне экрана не построены.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

const _headerHeight = 60.0;
const _productRowHeight = 258.0;

sealed class _Row {
  final String categoryId;
  _Row(this.categoryId);
}

class _HeaderRow extends _Row {
  final String title;
  _HeaderRow(super.categoryId, this.title);
}

class _ProductsRow extends _Row {
  final List<Product> products;
  _ProductsRow(super.categoryId, this.products);
}

class _MenuScreenState extends State<MenuScreen> {
  late Future<MenuResponse> _future;
  final _listController = ScrollController();
  final _chipsController = ScrollController();

  final List<_Row> _rows = [];
  List<MenuCategory> _categories = [];
  /// categoryId → смещение заголовка от начала списка
  final Map<String, double> _offsets = {};
  String? _activeCategory;
  bool _programmaticScroll = false;

  @override
  void initState() {
    super.initState();
    _future = context.read<ApiClient>().fetchMenu();
    _listController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _listController.dispose();
    _chipsController.dispose();
    super.dispose();
  }

  void _buildRows(MenuResponse menu) {
    if (_rows.isNotEmpty) return; // строим один раз
    _categories = menu.categories;
    var offset = 0.0;
    for (final c in menu.categories) {
      _offsets[c.id] = offset;
      _rows.add(_HeaderRow(c.id, c.name));
      offset += _headerHeight;
      for (var i = 0; i < c.products.length; i += 2) {
        _rows.add(_ProductsRow(
          c.id,
          c.products.sublist(i, (i + 2).clamp(0, c.products.length)),
        ));
        offset += _productRowHeight;
      }
    }
    _activeCategory = menu.categories.first.id;
  }

  void _onScroll() {
    if (_programmaticScroll || _categories.isEmpty) return;
    final offset = _listController.offset + 1;
    String current = _categories.first.id;
    for (final c in _categories) {
      if ((_offsets[c.id] ?? 0) <= offset) {
        current = c.id;
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
    final target = (index * 110.0 - 60)
        .clamp(0.0, _chipsController.position.maxScrollExtent);
    _chipsController.animateTo(target,
        duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
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
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
    );
    _programmaticScroll = false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: FutureBuilder<MenuResponse>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _ErrorView(
                message: snapshot.error.toString(),
                onRetry: () => setState(
                    () => _future = context.read<ApiClient>().fetchMenu()),
              );
            }

            final menu = snapshot.data!;
            _buildRows(menu);

            return Column(
              children: [
                _TopBar(title: menu.tenantName),
                _CategoryChips(
                  categories: _categories,
                  activeId: _activeCategory,
                  controller: _chipsController,
                  onTap: _jumpToCategory,
                ),
                Expanded(
                  child: ListView.builder(
                    controller: _listController,
                    itemCount: _rows.length,
                    itemExtent: null,
                    itemBuilder: (context, index) {
                      final row = _rows[index];
                      if (row is _HeaderRow) {
                        return SizedBox(
                          height: _headerHeight,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                            child: Text(
                              row.title,
                              style: const TextStyle(
                                  fontSize: 24, fontWeight: FontWeight.w800),
                            ),
                          ),
                        );
                      }
                      final products = (row as _ProductsRow).products;
                      return SizedBox(
                        height: _productRowHeight,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 4),
                          child: Row(
                            children: [
                              for (final p in products)
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 4),
                                    child: ProductCard(
                                      product: p,
                                      onTap: () => Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              ProductScreen(product: p),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              if (products.length == 1)
                                const Expanded(child: SizedBox()),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
      bottomNavigationBar: const _CartBar(),
    );
  }
}

class _TopBar extends StatelessWidget {
  final String title;
  const _TopBar({required this.title});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      alignment: Alignment.center,
      child: Text(
        title,
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _CategoryChips extends StatelessWidget {
  final List<MenuCategory> categories;
  final String? activeId;
  final ScrollController controller;
  final ValueChanged<String> onTap;

  const _CategoryChips({
    required this.categories,
    required this.activeId,
    required this.controller,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      color: Colors.white,
      child: ListView.separated(
        controller: controller,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: categories.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final c = categories[i];
          final active = c.id == activeId;
          return GestureDetector(
            onTap: () => onTap(c.id),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active ? Colors.black : const Color(0xFFF1F1F1),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                c.name,
                style: TextStyle(
                  color: active ? Colors.white : Colors.black87,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Нижняя плашка корзины — появляется, когда что-то добавили
class _CartBar extends StatelessWidget {
  const _CartBar();

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<Cart>();
    if (cart.isEmpty) return const SizedBox.shrink();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        child: SizedBox(
          height: 56,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.black,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
            ),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CartScreen()),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Корзина · ${cart.count}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
                Text(formatTenge(cart.subtotal),
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Не удалось загрузить меню',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54)),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Повторить')),
          ],
        ),
      ),
    );
  }
}
