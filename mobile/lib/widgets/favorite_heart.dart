import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';

/// Сердечко «в избранное».
///
/// Заливается маджентовым, а не оранжевым: это выгода клиента, а не
/// действие с заказом — та же логика, что у подарков и баллов
/// (см. `docs/DESIGN_SYSTEM.md`).
///
/// В момент включения сердце коротко «набухает» с перелётом — единственное
/// заметное движение, которое здесь уместно; при снятии оно просто гаснет,
/// потому что отмена не праздник.
class FavoriteHeart extends StatefulWidget {
  final bool active;
  final VoidCallback onTap;

  /// На карточке товара сердце крупнее, чем в списке
  final double size;

  const FavoriteHeart({
    super.key,
    required this.active,
    required this.onTap,
    this.size = 28,
  });

  @override
  State<FavoriteHeart> createState() => _FavoriteHeartState();
}

class _FavoriteHeartState extends State<FavoriteHeart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pop = AnimationController(
    vsync: this,
    duration: Motion.slow,
  );

  @override
  void didUpdateWidget(covariant FavoriteHeart old) {
    super.didUpdateWidget(old);
    if (widget.active && !old.active) _pop.forward(from: 0);
  }

  @override
  void dispose() {
    _pop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {
        widget.active ? Haptics.tap() : Haptics.success();
        widget.onTap();
      },
      // Иконка мелкая, но попасть в неё нужно на ходу
      child: SizedBox(
        width: Hit.min,
        height: Hit.min,
        child: Center(
          child: Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              // Подложка нужна, чтобы сердце читалось поверх любой фотографии
              color: c.surface.withValues(alpha: 0.92),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: c.ink.withValues(alpha: 0.10),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: ScaleTransition(
              // Последовательность, а не Interval: сердце должно вернуться
              // к обычному размеру, иначе оно навсегда останется раздутым.
              scale: TweenSequence<double>([
                TweenSequenceItem(
                  tween: Tween(begin: 1.0, end: 1.28)
                      .chain(CurveTween(curve: Motion.enter)),
                  weight: 40,
                ),
                TweenSequenceItem(
                  tween: Tween(begin: 1.28, end: 1.0)
                      .chain(CurveTween(curve: Motion.change)),
                  weight: 60,
                ),
              ]).animate(_pop),
              child: Icon(
                widget.active ? Icons.favorite : Icons.favorite_border,
                size: widget.size * 0.58,
                color: widget.active ? c.accent : c.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
