import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/models.dart';
import '../state/cart.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;

  const ProductCard({super.key, required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final inCart = context.select<Cart, int>((c) => c.qtyOf(product));

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: ProductImage(url: product.photoUrl)),
                  if (product.isHit || product.isSpicy || product.isNew)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: ProductBadges(product: product, compact: true),
                    ),
                  if (inCart > 0)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '$inCart в корзине',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      height: 1.2,
                    ),
                  ),
                  if (product.weightLabel.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      product.weightLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black45,
                      ),
                    ),
                  ],
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          formatTenge(product.price),
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      _AddButton(product: product, onTap: onTap),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ProductBadges extends StatelessWidget {
  final Product product;
  final bool compact;

  const ProductBadges({super.key, required this.product, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final badges = <({String text, Color color})>[
      if (product.isHit) (text: 'Хит', color: const Color(0xFFFFA000)),
      if (product.isSpicy) (text: 'Острое', color: const Color(0xFFE53935)),
      if (product.isNew) (text: 'Новинка', color: const Color(0xFF2E7D32)),
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

class _AddButton extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;

  const _AddButton({required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 32,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFF1F1F1),
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        onPressed: () {
          // с выбором модификаторов — открываем карточку
          if (product.hasChoices) {
            onTap();
          } else {
            context.read<Cart>().add(product);
          }
        },
        child: Text(
          product.hasChoices ? 'Выбрать' : '+',
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
      ),
    );
  }
}

/// Картинка товара с плейсхолдером — фото есть не у всех позиций Poster
class ProductImage extends StatelessWidget {
  final String? url;
  const ProductImage({super.key, required this.url});

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return const _ImagePlaceholder();
    return Image.network(
      url!,
      fit: BoxFit.cover,
      // Poster and the R2 staging domain do not allow CanvasKit's
      // cross-origin image fetches. On the web, render a native <img>
      // immediately; iOS/Android keep using the regular Flutter pipeline.
      webHtmlElementStrategy: WebHtmlElementStrategy.prefer,
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
