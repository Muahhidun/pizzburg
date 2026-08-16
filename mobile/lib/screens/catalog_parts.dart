import 'dart:ui';

import 'package:flutter/material.dart';
import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/favorite_heart.dart';
import '../widgets/motion.dart';

/// Части экрана каталога, вынесенные из `menu_screen.dart`, чтобы сам
/// экран остался читаемым: там логика якорей и загрузки, здесь — верстка.

/// Переключатель «Доставка / Самовывоз».
///
/// Когда доставка закрыта, её половина не просто серая, а не реагирует на
/// тап: человек не должен выбрать способ, которым заказ всё равно не
/// примут, и получить ошибку в конце оформления.
class ModeSwitch extends StatelessWidget {
  final String mode; // DELIVERY | PICKUP
  final bool deliveryAvailable;
  final ValueChanged<String> onChanged;

  /// Переключатель стоит на тёмном хедере. Если оставить «активный = чёрный»
  /// из хендоффа (он рисовался на белом фоне), выбранная половина сливается
  /// с фоном, а невыбранная — белая капсула — притягивает взгляд, и человек
  /// читает выбор наоборот. Поэтому на тёмном полярность инвертирована.
  final bool onDark;

  const ModeSwitch({
    super.key,
    required this.mode,
    required this.deliveryAvailable,
    required this.onChanged,
    this.onDark = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _Half(
            label: 'Доставка',
            active: mode == 'DELIVERY',
            disabled: !deliveryAvailable,
            onDark: onDark,
            onTap: () => onChanged('DELIVERY'),
          ),
        ),
        const SizedBox(width: 7),
        Expanded(
          child: _Half(
            label: 'Самовывоз',
            active: mode == 'PICKUP',
            onDark: onDark,
            onTap: () => onChanged('PICKUP'),
          ),
        ),
      ],
    );
  }
}

class _Half extends StatelessWidget {
  final String label;
  final bool active;
  final bool disabled;
  final bool onDark;
  final VoidCallback onTap;

  const _Half({
    required this.label,
    required this.active,
    required this.onTap,
    this.disabled = false,
    this.onDark = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    final Color background;
    final Color text;
    if (disabled) {
      background = onDark
          ? c.surface.withValues(alpha: 0.06)
          : const Color(0x0A0E0D10);
      text = onDark
          ? c.surface.withValues(alpha: 0.35)
          : c.muted.withValues(alpha: 0.6);
    } else if (active) {
      background = onDark ? c.surface : c.ink;
      text = onDark ? c.ink : c.surface;
    } else {
      background = onDark ? c.surface.withValues(alpha: 0.12) : c.surface;
      text = onDark ? c.surface.withValues(alpha: 0.75) : c.muted;
    }

    return PressScale.selection(
      onTap: disabled ? null : onTap,
      child: AnimatedContainer(
        duration: Motion.base,
        curve: Motion.change,
        padding: const EdgeInsets.symmetric(vertical: 12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: background,
          borderRadius: R.pill,
          border: !onDark && !active && !disabled
              ? Border.all(color: c.border)
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: text,
          ),
        ),
      ),
    );
  }
}

/// Плавающий стеклянный островок с категориями.
///
/// Тот же материал, что у нижнего бара, и по той же причине: список должен
/// уходить под него, а не упираться в непрозрачную панель. Прошлый вариант
/// был закреплённой полосой во всю ширину, и над ней приходилось держать
/// чернильную заглушку под статус-бар — та съедала иконки часов, потому что
/// стиль статус-бара к тому моменту уже переключался на тёмный.
class GlassChipsBar extends StatelessWidget {
  final Widget child;

  /// Островок появляется, только когда строка категорий из потока ушла под
  /// верх экрана: до этого он дублировал бы её.
  final bool visible;

  const GlassChipsBar({super.key, required this.child, required this.visible});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return IgnorePointer(
      ignoring: !visible,
      child: AnimatedSlide(
        offset: visible ? Offset.zero : const Offset(0, -0.45),
        duration: Motion.base,
        curve: Motion.change,
        child: AnimatedOpacity(
          opacity: visible ? 1 : 0,
          duration: Motion.fast,
          child: ClipRRect(
            borderRadius: R.pill,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: R.pill,
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Color.lerp(
                        c.surface,
                        c.ink,
                        0.045,
                      )!.withValues(alpha: 0.80),
                      Color.lerp(
                        c.surface,
                        c.ink,
                        0.07,
                      )!.withValues(alpha: 0.62),
                    ],
                  ),
                  border: Border.all(
                    color: c.ink.withValues(alpha: 0.05),
                    width: 0.8,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: c.ink.withValues(alpha: 0.12),
                      blurRadius: 28,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: SizedBox(height: Hit.min + Gap.sm * 2, child: child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Чипсы категорий — якоря непрерывного скролла, а не фильтр.
class CategoryChips extends StatelessWidget {
  final List<MenuCategory> categories;
  final String? activeId;
  final ScrollController controller;
  final ValueChanged<String> onTap;

  const CategoryChips({
    super.key,
    required this.categories,
    required this.activeId,
    required this.controller,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SizedBox(
      height: Hit.min,
      child: ListView.separated(
        controller: controller,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Gap.screen),
        itemCount: categories.length,
        separatorBuilder: (_, _) => const SizedBox(width: Gap.sm),
        itemBuilder: (_, i) {
          final category = categories[i];
          final active = category.id == activeId;
          return Center(
            child: PressScale.selection(
              onTap: () => onTap(category.id),
              child: AnimatedContainer(
                duration: Motion.base,
                curve: Motion.change,
                padding: const EdgeInsets.symmetric(
                  horizontal: 15,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: active ? c.accent : c.fillSoft,
                  borderRadius: R.pill,
                ),
                child: Text(
                  category.name,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                    color: active ? c.surface : c.muted,
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Строка товара: миниатюра 76, название, состав и вес, цена и «+».
///
/// Стоп-лист не прячет позицию, а гасит её и объясняет причину: человек
/// должен понимать, что блюдо существует и вернётся, а не решить, что его
/// убрали из меню навсегда.
class ProductRow extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;
  final VoidCallback onAdd;
  final bool inStopList;

  /// Сколько этого товара уже в корзине. Пока 0 — показываем «+»; как только
  /// товар добавлен, на его месте появляется счётчик: человек должен видеть
  /// результат своего тапа прямо в списке, а не ходить проверять в корзину.
  final int inCart;
  final VoidCallback? onRemove;

  /// Сердечко показываем только вошедшим: избранное хранится на сервере,
  /// и гостю кнопка обещала бы сохранение, которого не будет.
  final bool? favorite;
  final VoidCallback? onToggleFavorite;

  const ProductRow({
    super.key,
    required this.product,
    required this.onTap,
    required this.onAdd,
    this.inStopList = false,
    this.inCart = 0,
    this.onRemove,
    this.favorite,
    this.onToggleFavorite,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final subtitle = [
      if (product.weightLabel.isNotEmpty) product.weightLabel,
      if (product.description.isNotEmpty) product.description,
    ].join(' · ');

    return PressScale(
      onTap: onTap,
      scale: 0.99,
      child: Opacity(
        opacity: inStopList ? 0.45 : 1,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: Gap.md),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: c.line)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 76,
                height: 76,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    ClipRRect(
                      borderRadius: R.thumb,
                      child: SizedBox(
                        width: 76,
                        height: 76,
                        child: _Photo(
                          url: product.photoUrl,
                          grayscale: inStopList,
                          fallback: c.fillSoft,
                        ),
                      ),
                    ),
                    if (favorite != null && onToggleFavorite != null)
                      Positioned(
                        top: -6,
                        right: -8,
                        child: FavoriteHeart(
                          active: favorite!,
                          onTap: onToggleFavorite!,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: Gap.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      inStopList ? 'Закончилась, вернём завтра' : subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Gap.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    // В списке цена без «₸» — символ появляется в итогах
                    formatTenge(product.price, withCurrency: false),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: Gap.sm),
                  if (inStopList)
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
                        'нет',
                        style: TextStyle(fontSize: 13, color: c.muted),
                      ),
                    )
                  else if (inCart > 0)
                    _QtyStepper(qty: inCart, onAdd: onAdd, onRemove: onRemove)
                  else
                    Builder(
                      builder: (btn) => PressScale(
                        onTap: () {
                          flyToCart(btn);
                          onAdd();
                        },
                        child: Container(
                          // Кнопка визуально 34, но тап-зона расширена до 44:
                          // иначе в неё трудно попасть на ходу
                          constraints: const BoxConstraints(
                            minWidth: Hit.min,
                            minHeight: Hit.min,
                          ),
                          alignment: Alignment.center,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 8,
                            ),
                            decoration: BoxDecoration(
                              color: c.accent,
                              borderRadius: R.pill,
                            ),
                            child: Icon(Icons.add, size: 16, color: c.surface),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
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
    return ColorFiltered(
      colorFilter: const ColorFilter.matrix([
        0.2126, 0.7152, 0.0722, 0, 0, //
        0.2126, 0.7152, 0.0722, 0, 0, //
        0.2126, 0.7152, 0.0722, 0, 0, //
        0, 0, 0, 1, 0,
      ]),
      child: image,
    );
  }
}

/// Счётчик на месте «+»: минус, количество, плюс.
///
/// Появляется вместо кнопки добавления, как только товар попал в корзину.
class _QtyStepper extends StatelessWidget {
  final int qty;
  final VoidCallback onAdd;
  final VoidCallback? onRemove;

  const _QtyStepper({required this.qty, required this.onAdd, this.onRemove});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      height: 34,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Step(icon: Icons.remove, onTap: onRemove, color: c.surface),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Text(
              '$qty',
              style: TextStyle(
                fontFamily: 'Unbounded',
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: c.surface,
              ),
            ),
          ),
          _Step(icon: Icons.add, onTap: onAdd, color: c.surface),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final Color color;

  const _Step({required this.icon, required this.onTap, required this.color});

  @override
  Widget build(BuildContext context) => PressScale(
    onTap: onTap,
    child: SizedBox(
      width: 30,
      height: 34,
      child: Icon(icon, size: 15, color: color),
    ),
  );
}

/// Плавающая кнопка корзины. Появляется пружиной, когда корзина
/// перестаёт быть пустой, — это момент, который стоит заметить.
class FloatingCart extends StatelessWidget {
  final int total;
  final int count;
  final VoidCallback onTap;

  const FloatingCart({
    super.key,
    required this.total,
    required this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AnimatedSlide(
      offset: count == 0 ? const Offset(0, 2) : Offset.zero,
      duration: Motion.slow,
      curve: count == 0 ? Motion.change : Motion.benefit,
      child: AnimatedOpacity(
        opacity: count == 0 ? 0 : 1,
        duration: Motion.base,
        child: PressScale(
          onTap: count == 0 ? null : onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 12, 12, 12),
            decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                AnimatedMoney(
                  total,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontSize: 17,
                    color: c.surface,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    'Корзина · $count',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: c.ink,
                    ),
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

/// Поиск по меню.
///
/// Ищем и по названию, и по составу: человек чаще помнит «с халапеньо»,
/// чем точное имя блюда. Живёт над списком и не трогает якоря категорий —
/// пока строка не пуста, список подменяется результатами.
class MenuSearch extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  const MenuSearch({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.only(left: Gap.lg, right: 6),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.pill),
      child: Row(
        children: [
          Icon(Icons.search, size: 18, color: c.muted),
          const SizedBox(width: Gap.sm),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Найти блюдо',
                hintStyle: TextStyle(fontSize: 14.5, color: c.muted),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
              ),
              style: const TextStyle(fontSize: 14.5),
            ),
          ),
          if (controller.text.isNotEmpty)
            PressScale(
              onTap: onClear,
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Icon(Icons.close, size: 18, color: c.muted),
              ),
            ),
        ],
      ),
    );
  }
}

/// Ничего не нашлось. Не тупик: предлагаем сбросить и вернуться к меню.
class SearchEmpty extends StatelessWidget {
  final String query;
  final VoidCallback onClear;

  const SearchEmpty({super.key, required this.query, required this.onClear});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Container(
            width: 92,
            height: 92,
            decoration: BoxDecoration(
              color: c.accentSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.search_off, size: 34, color: c.accent),
          ),
          const SizedBox(height: Gap.block),
          Text(
            'Ничего не нашли',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontSize: 20),
          ),
          const SizedBox(height: Gap.sm),
          Text(
            'По запросу «$query» блюд нет. Проверьте написание или посмотрите меню целиком.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: Gap.block),
          PressScale(
            onTap: onClear,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
              decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
              child: Text(
                'Показать всё меню',
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                  color: c.surface,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
