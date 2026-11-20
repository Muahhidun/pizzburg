// Визуальные части карточки товара: фото и метки.
//
// Сетка карточек из первой версии заменена списком строк по хендоффу
// («Сигнал»), поэтому сам ProductCard удалён — остались только куски,
// которые переиспользует экран товара.

import 'package:flutter/material.dart';
import '../api/models.dart';
import '../i18n/strings.dart';

class ProductBadges extends StatelessWidget {
  final Product product;
  final bool compact;

  const ProductBadges({super.key, required this.product, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final badges = <({String text, Color color})>[
      if (product.isHit) (text: S.badgeHit, color: const Color(0xFFFFA000)),
      if (product.isSpicy) (text: S.badgeSpicy, color: const Color(0xFFE53935)),
      if (product.isNew) (text: S.badgeNew, color: const Color(0xFF2E7D32)),
    ];

    return Wrap(
      spacing: 5,
      runSpacing: 5,
      alignment: WrapAlignment.end,
      children: badges
          .map(
            (badge) => Container(
              padding: EdgeInsets.symmetric(
                horizontal: compact ? 7 : 9,
                vertical: compact ? 3 : 5,
              ),
              decoration: BoxDecoration(
                color: badge.color,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                badge.text,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: compact ? 10 : 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class ProductImage extends StatelessWidget {
  final String? url;
  const ProductImage({super.key, required this.url});

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return const _ImagePlaceholder();
    return Image.network(
      url!,
      fit: BoxFit.cover,
      // Web: draw on the Flutter canvas first; a native <img> moves apart
      // from the canvas while scrolling. <img> is only the fallback for
      // hosts without CORS (Poster).
      webHtmlElementStrategy: WebHtmlElementStrategy.fallback,
      errorBuilder: (context, error, stack) => const _ImagePlaceholder(),
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : const _ImagePlaceholder(),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFEFEFEF),
      child: const Center(
        child: Icon(Icons.restaurant, color: Color(0xFFBDBDBD), size: 32),
      ),
    );
  }
}
