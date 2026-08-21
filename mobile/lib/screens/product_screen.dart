import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../state/favorites.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/favorite_heart.dart';
import '../widgets/motion.dart';

/// Карточка товара по прототипу «Сигнал».
///
/// Товар в стоп-листе не прячется и не даёт кнопку в корзину: вместо
/// конфигуратора появляется объяснение и предложение похожего. Человек
/// должен понять, что блюдо существует и вернётся.
class ProductScreen extends StatefulWidget {
  final Product product;

  /// Товар недоступен сегодня
  final bool inStopList;

  /// Чем заменить — показывается только в состоянии «закончилась»
  final List<Product> alternatives;

  const ProductScreen({
    super.key,
    required this.product,
    this.inStopList = false,
    this.alternatives = const [],
  });

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  final Map<String, ModifierOption> _selected = {};

  @override
  void initState() {
    super.initState();
    // Обязательные группы предзаполняем первым вариантом: иначе кнопка
    // «В корзину» неактивна без единой подсказки, почему.
    for (final group in widget.product.modifierGroups) {
      if (group.min > 0 && group.options.isNotEmpty) {
        _selected[group.id] = group.options.first;
      }
    }
  }

  bool get _isComplete => widget.product.modifierGroups
      .where((g) => g.min > 0)
      .every((g) => _selected.containsKey(g.id));

  int get _total =>
      widget.product.price +
      _selected.values.fold(0, (sum, option) => sum + option.price);

  void _addToCart() {
    Haptics.success();
    context.read<Cart>().add(
      widget.product,
      modifiers: _selected.values.toList(),
    );
    Navigator.pop(context);
  }

  Future<void> _toggleFavorite(Favorites favorites) async {
    try {
      await favorites.toggle(widget.product.id);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Не удалось сохранить — попробуйте ещё раз'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final p = widget.product;
    final authed = context.watch<AuthState>().isAuthenticated;
    final favorites = context.watch<Favorites>();

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.screen, Gap.md, Gap.screen, 24),
          children: [
            Row(
              children: [
                PressScale(
                  onTap: () => Navigator.pop(context),
                  child: Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: c.fillSoft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.arrow_back, size: 18, color: c.ink),
                  ),
                ),
                const Spacer(),
                if (authed) ...[
                  FavoriteHeart(
                    active: favorites.contains(p.id),
                    size: 36,
                    onTap: () => _toggleFavorite(favorites),
                  ),
                  const SizedBox(width: Gap.xs),
                ],
                if (p.weightLabel.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: c.fillSoft,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      p.weightLabel,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w500,
                        color: c.muted,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: Gap.lg),

            ClipRRect(
              borderRadius: R.photo,
              child: SizedBox(
                height: 200,
                width: double.infinity,
                child: _Photo(
                  url: p.photoUrl,
                  grayscale: widget.inStopList,
                  fallback: c.fillSoft,
                ),
              ),
            ),
            const SizedBox(height: Gap.block),

            Text(p.name, style: Theme.of(context).textTheme.headlineMedium),
            if (p.description.isNotEmpty) ...[
              const SizedBox(height: Gap.sm),
              Text(
                p.description,
                style: TextStyle(fontSize: 13.5, height: 1.55, color: c.muted),
              ),
            ],

            if (widget.inStopList)
              _StopListBlock(alternatives: widget.alternatives)
            else
              for (final group in p.modifierGroups) ...[
                const SizedBox(height: Gap.blockWide),
                Text(
                  group.name,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Gap.md),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    for (final option in group.options)
                      _OptionChip(
                        label: option.price > 0
                            ? '${option.name} +${option.price}'
                            : option.name,
                        selected: _selected[group.id]?.id == option.id,
                        onTap: () => setState(() {
                          // Повторный тап по выбранному снимает выбор,
                          // если группа необязательная.
                          if (_selected[group.id]?.id == option.id &&
                              group.min == 0) {
                            _selected.remove(group.id);
                          } else {
                            _selected[group.id] = option;
                          }
                        }),
                      ),
                  ],
                ),
              ],
          ],
        ),
      ),
      bottomNavigationBar: widget.inStopList
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  Gap.screen,
                  0,
                  Gap.screen,
                  Gap.md,
                ),
                child: PressScale(
                  onTap: _isComplete ? _addToCart : null,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(22, 12, 12, 12),
                    decoration: BoxDecoration(color: c.panel, borderRadius: R.pill),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        AnimatedMoney(
                          _total,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(color: c.surface),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 22,
                            vertical: 15,
                          ),
                          decoration: BoxDecoration(
                            color: _isComplete ? c.accent : c.muted,
                            borderRadius: R.pill,
                          ),
                          child: Text(
                            'В корзину',
                            style: TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                              color: c.surface,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

class _OptionChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _OptionChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale.selection(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.base,
        curve: Motion.change,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? c.accent : c.surface,
          borderRadius: R.pill,
          border: selected ? null : Border.all(color: c.border),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: selected ? c.surface : c.ink,
          ),
        ),
      ),
    );
  }
}

/// «Сегодня закончилась» + похожее в наличии.
class _StopListBlock extends StatelessWidget {
  final List<Product> alternatives;
  const _StopListBlock({required this.alternatives});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: Gap.blockWide),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0x0A0E0D10),
            borderRadius: R.photo,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Сегодня закончилась',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontSize: 17),
              ),
              const SizedBox(height: Gap.sm),
              Text(
                'Вернём в меню, когда привезут продукты. '
                'Можем написать, как только появится.',
                style: TextStyle(fontSize: 13.5, height: 1.5, color: c.muted),
              ),
              const SizedBox(height: Gap.lg),
              PressScale(
                onTap: () {
                  Haptics.tap();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Напишем, когда блюдо вернётся в меню'),
                    ),
                  );
                },
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: c.panel, borderRadius: R.pill),
                  child: Text(
                    'Сообщить о поступлении',
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: c.surface,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (alternatives.isNotEmpty) ...[
          const SizedBox(height: Gap.blockWide),
          const Text(
            'Похожее в наличии',
            style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: Gap.md),
          Row(
            children: [
              for (final alt in alternatives.take(2)) ...[
                Expanded(child: _AltCard(product: alt)),
                if (alt != alternatives.take(2).last)
                  const SizedBox(width: Gap.md),
              ],
            ],
          ),
        ],
      ],
    );
  }
}

class _AltCard extends StatelessWidget {
  final Product product;
  const _AltCard({required this.product});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: () => Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => ProductScreen(product: product)),
      ),
      child: Container(
        padding: const EdgeInsets.all(Gap.md),
        decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.thumb),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: SizedBox(
                height: 72,
                width: double.infinity,
                child: _Photo(
                  url: product.photoUrl,
                  grayscale: false,
                  fallback: c.border,
                ),
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              product.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 2),
            Text(
              formatTenge(product.price),
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontSize: 13.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _Photo extends StatelessWidget {
  final String? url;
  final bool grayscale;
  final Color fallback;

  const _Photo({
    required this.url,
    required this.grayscale,
    required this.fallback,
  });

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return ColoredBox(color: fallback);
    final image = Image.network(
      url!,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => ColoredBox(color: fallback),
    );
    if (!grayscale) return image;
    return Opacity(
      opacity: 0.45,
      child: ColorFiltered(
        colorFilter: const ColorFilter.matrix([
          0.2126, 0.7152, 0.0722, 0, 0, //
          0.2126, 0.7152, 0.0722, 0, 0, //
          0.2126, 0.7152, 0.0722, 0, 0, //
          0, 0, 0, 1, 0,
        ]),
        child: image,
      ),
    );
  }
}
