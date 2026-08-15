import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../state/favorites.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'catalog_parts.dart';
import 'product_screen.dart';

/// Избранное.
///
/// Список приходит с сервера с актуальными ценой и стоп-листом, а не с теми,
/// что были на момент добавления: иначе человек увидит цену прошлого месяца
/// и придёт с ней на кассу.
class FavoritesScreen extends StatefulWidget {
  /// Открыть каталог — избранное пустое чаще, чем корзина
  final VoidCallback onOpenMenu;

  const FavoritesScreen({super.key, required this.onOpenMenu});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  List<FavoriteProduct>? _items;
  String? _error;
  bool _wasAuthenticated = false;
  bool _reloading = false;

  Future<void> _load() async {
    try {
      final items = await context.read<ApiClient>().fetchFavorites();
      if (mounted) {
        setState(() {
          _items = items;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _toggle(FavoriteProduct item) async {
    // Убираем из списка сразу: оставленная строка с пустым сердцем выглядит
    // как несработавшее нажатие.
    setState(() => _items = _items?.where((i) => i.id != item.id).toList());
    try {
      await context.read<Favorites>().toggle(item.id);
    } catch (_) {
      if (mounted) _load();
    }
  }

  /// Экран живёт в `IndexedStack` и не пересоздаётся, поэтому синхронизацию
  /// приходится вести самому: после входа список нужно подтянуть, после
  /// выхода — стереть, а после сердечка, нажатого в каталоге, — перечитать.
  /// Загружаем после кадра: `setState` во время build запрещён.
  void _syncWith(bool authed, Favorites favorites) {
    if (authed != _wasAuthenticated) {
      _wasAuthenticated = authed;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (authed) {
          _load();
        } else {
          setState(() => _items = const []);
        }
      });
      return;
    }
    if (!authed || _items == null || _reloading) return;
    if (favorites.loaded && favorites.count != _items!.length) {
      _reloading = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (mounted) await _load();
        _reloading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final authed = context.watch<AuthState>().isAuthenticated;
    final favorites = context.watch<Favorites>();
    _syncWith(authed, favorites);
    final items = _items;

    return Scaffold(
      backgroundColor: c.surface,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Gap.screen,
                Gap.lg,
                Gap.screen,
                Gap.sm,
              ),
              child: Text(
                'Избранное',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            Expanded(
              child: !authed
                  ? _FavoritesEmpty(
                      title: 'Войдите, чтобы сохранять',
                      text: 'Избранное привязано к номеру телефона — '
                          'оно останется с вами на любом устройстве',
                      action: 'Открыть меню',
                      onAction: widget.onOpenMenu,
                    )
                  : _error != null
                      ? _FavoritesEmpty(
                          title: 'Не удалось загрузить',
                          text: _error!,
                          action: 'Повторить',
                          onAction: _load,
                        )
                      : items == null
                          ? const Center(child: CircularProgressIndicator())
                          : items.isEmpty
                              ? _FavoritesEmpty(
                                  title: 'Пока пусто',
                                  text: 'Нажмите на сердечко у блюда в меню — '
                                      'оно окажется здесь',
                                  action: 'Открыть меню',
                                  onAction: widget.onOpenMenu,
                                )
                              : _list(items),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list(List<FavoriteProduct> items) {
    final cart = context.watch<Cart>();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: EdgeInsets.fromLTRB(
          Gap.screen,
          0,
          Gap.screen,
          // Плавающий бар перекрывает низ списка — оставляем ему место
          Gap.navBarSpace(context),
        ),
        itemCount: items.length,
        itemBuilder: (context, i) {
          final item = items[i];
          final product = item.toProduct();
          return StaggeredEntrance(
            index: i,
            child: ProductRow(
              product: product,
              inStopList: item.inStopList,
              favorite: true,
              onToggleFavorite: () => _toggle(item),
              inCart: cart.qtyOf(product),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ProductScreen(product: product),
                ),
              ),
              onAdd: () {
                if (item.inStopList) return;
                Haptics.tap();
                cart.add(product);
              },
              onRemove: () => cart.decrementProduct(product),
            ),
          );
        },
      ),
    );
  }
}

class _FavoritesEmpty extends StatelessWidget {
  final String title;
  final String text;
  final String action;
  final VoidCallback onAction;

  const _FavoritesEmpty({
    required this.title,
    required this.text,
    required this.action,
    required this.onAction,
  });

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
                color: c.benefitSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.favorite_border, size: 34, color: c.benefit),
            ),
            const SizedBox(height: Gap.block),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontSize: 20),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              text,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: Gap.blockWide),
            PressScale(
              onTap: onAction,
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
                  action,
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
