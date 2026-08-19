import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/motion.dart';

/// Акцентный хедер каталога: куда везём, за сколько, и блок повтора.
///
/// Хендофф ставит сюда «Тот же заказ?» первым экраном не случайно:
/// ключевой сценарий заведения — повторный заказ, и он должен занимать
/// один тап, а не проход по каталогу.
class CatalogHeader extends StatelessWidget {
  final String addressLabel;
  final String etaLabel;
  final String mode;
  final Availability availability;

  /// Блок повтора; null — заказов ещё не было или заведение закрыто
  final Widget? repeatBlock;

  /// Активный заказ: пока он в работе, он важнее предложения повторить.
  final Widget? activeOrderBlock;
  final VoidCallback? onAddressTap;
  final ValueChanged<String> onModeChanged;

  const CatalogHeader({
    super.key,
    required this.addressLabel,
    required this.etaLabel,
    required this.mode,
    required this.availability,
    required this.onModeChanged,
    this.repeatBlock,
    this.activeOrderBlock,
    this.onAddressTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final closed = !availability.deliveryAvailable || !availability.isOpenNow;

    // Статус-бар лежит поверх цветного хедера: без светлых иконок время и
    // батарея сливаются с фоном. Оборачиваем именно хедер, а не весь экран,
    // иначе на других вкладках со светлым фоном иконки пропадут.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarBrightness: Brightness.dark,
        statusBarIconBrightness: Brightness.light,
        statusBarColor: Colors.transparent,
      ),
      child: Container(
        width: double.infinity,
        // Хедер заходит ПОД статус-бар, поэтому сверху добавляем его высоту.
        // Иначе над цветным блоком остаётся белая полоса с часами.
        padding: EdgeInsets.fromLTRB(
          Gap.screen,
          MediaQuery.of(context).padding.top + 10,
          Gap.screen,
          26,
        ),
        decoration: BoxDecoration(
          color: c.accent,
          borderRadius: R.headerBottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: PressScale(
                    onTap: onAddressTap,
                    scale: 0.98,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          mode == 'PICKUP' ? 'Заберёте из' : 'Доставим на',
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.35,
                            fontWeight: FontWeight.w500,
                            color: c.surface.withValues(alpha: 0.7),
                          ),
                        ),
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                addressLabel,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: c.surface,
                                ),
                              ),
                            ),
                            Icon(
                              Icons.keyboard_arrow_down,
                              size: 16,
                              color: c.surface,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                // Пустая подпись — значит о состоянии сказать нечего.
                // Рисовать пустую плашку незачем: она занимает место и
                // читается как сломанная.
                if (etaLabel.isNotEmpty) ...[
                  const SizedBox(width: Gap.md),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: c.surface.withValues(alpha: 0.14),
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      etaLabel,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: c.surface,
                      ),
                    ),
                  ),
                ],
              ],
            ),

            // Предупреждение о закрытой доставке — до блока повтора: сначала
            // объясняем, почему всё выглядит иначе, потом предлагаем действие.
            if (closed && availability.message != null) ...[
              const SizedBox(height: Gap.lg),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(Gap.lg),
                // Хедер теперь сам акцентный, поэтому предупреждение внутри
                // него набирается светлым по акценту, а не акцентом по тёмному:
                // акцент на акценте не читался бы вовсе.
                decoration: BoxDecoration(
                  color: c.surface.withValues(alpha: 0.14),
                  borderRadius: R.field,
                  border: Border.all(color: c.surface.withValues(alpha: 0.35)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      availability.isOpenNow
                          ? 'Доставка закрыта'
                          : 'Сейчас закрыто',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontSize: 16.5,
                        color: c.surface,
                      ),
                    ),
                    const SizedBox(height: Gap.xs),
                    Text(
                      availability.message!,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: c.surface.withValues(alpha: 0.8),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Активный заказ вытесняет блок повтора: пока еда едет, человек
            // заходит в приложение посмотреть «где мой заказ», а не заказать
            // ещё раз.
            if (activeOrderBlock != null) ...[
              const SizedBox(height: 20),
              Text(
                'Ваш заказ',
                style: Theme.of(
                  context,
                ).textTheme.displaySmall?.copyWith(color: c.surface),
              ),
              const SizedBox(height: Gap.md),
              BenefitReveal(child: activeOrderBlock!),
            ] else if (repeatBlock != null) ...[
              const SizedBox(height: 20),
              Text(
                'Тот же заказ?',
                style: Theme.of(
                  context,
                ).textTheme.displaySmall?.copyWith(color: c.surface),
              ),
              const SizedBox(height: Gap.md),
              BenefitReveal(child: repeatBlock!),
            ],
          ],
        ),
      ),
    );
  }
}

/// Скелетон каталога: повторяет структуру экрана, а не крутит спиннер.
/// Человек видит, что именно грузится, и не гадает, сломалось ли.
class CatalogSkeleton extends StatelessWidget {
  const CatalogSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Shimmer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(
              Gap.screen,
              MediaQuery.of(context).padding.top + 20,
              Gap.screen,
              26,
            ),
            decoration: BoxDecoration(
              color: c.accent,
              borderRadius: R.headerBottom,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Bar(
                  width: 120,
                  height: 12,
                  color: c.surface.withValues(alpha: 0.15),
                ),
                const SizedBox(height: Gap.sm),
                _Bar(
                  width: 180,
                  height: 16,
                  color: c.surface.withValues(alpha: 0.15),
                ),
                const SizedBox(height: 24),
                _Bar(
                  width: double.infinity,
                  height: 68,
                  color: c.surface.withValues(alpha: 0.08),
                  radius: 24,
                ),
                const SizedBox(height: Gap.block),
                Row(
                  children: [
                    Expanded(
                      child: _Bar(
                        height: 40,
                        color: c.surface.withValues(alpha: 0.12),
                        radius: 999,
                      ),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: _Bar(
                        height: 40,
                        color: c.surface.withValues(alpha: 0.12),
                        radius: 999,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: Gap.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screen),
            child: Row(
              children: [
                for (var i = 0; i < 3; i++) ...[
                  _Bar(width: 84, height: 36, color: c.fillSoft, radius: 999),
                  const SizedBox(width: Gap.sm),
                ],
              ],
            ),
          ),
          const SizedBox(height: Gap.block),
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Gap.screen,
                0,
                Gap.screen,
                Gap.block,
              ),
              child: Row(
                children: [
                  _Bar(width: 80, height: 80, color: c.fillSoft, radius: 22),
                  const SizedBox(width: Gap.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _Bar(width: 140, height: 13, color: c.fillSoft),
                        const SizedBox(height: Gap.sm),
                        _Bar(width: 200, height: 11, color: c.fillSoft),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final double? width;
  final double height;
  final Color color;
  final double radius;

  const _Bar({
    this.width,
    required this.height,
    required this.color,
    this.radius = 8,
  });

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
    ),
  );
}

/// Ошибка сети. Главное здесь — фраза «корзина сохранена»: без неё человек
/// боится, что набранное пропало, и уходит из приложения.
class CatalogError extends StatelessWidget {
  final String message;
  final int attempt;
  final VoidCallback onRetry;

  const CatalogError({
    super.key,
    required this.message,
    required this.onRetry,
    this.attempt = 1,
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
                color: c.accentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.wifi_off_rounded, size: 34, color: c.accent),
            ),
            const SizedBox(height: Gap.block),
            Text(
              'Меню не загрузилось',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: 21),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              'Не получается связаться с сервером. Проверьте интернет — корзина сохранена.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: Gap.blockWide),
            PressScale(
              onTap: onRetry,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 28,
                  vertical: 15,
                ),
                decoration: BoxDecoration(
                  color: c.accent,
                  borderRadius: R.pill,
                ),
                child: Text(
                  'Повторить',
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: c.surface,
                  ),
                ),
              ),
            ),
            const SizedBox(height: Gap.md),
            Text(
              'Попытка $attempt · $message',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
      ),
    );
  }
}
