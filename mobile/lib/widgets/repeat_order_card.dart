import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import 'motion.dart';

/// Блок повтора прошлого заказа — «Тот же заказ?».
///
/// В хендоффе это первое, что видит человек на главном экране: ключевой
/// сценарий заведения — повторный заказ, и он должен занимать один тап,
/// а не проход по каталогу.
///
/// Виджет один на три места: тёмный хедер каталога (`onDark`), пустая
/// корзина и экран заказов.
class RepeatOrderCard extends StatelessWidget {
  final LastOrder order;
  final MenuResponse? menu;

  /// На тёмном фоне хедера каталога карточка белая, на светлых экранах —
  /// с контуром.
  final bool onDark;

  /// Вызывается после успешного наполнения корзины
  final VoidCallback? onRepeated;

  const RepeatOrderCard({
    super.key,
    required this.order,
    required this.menu,
    this.onDark = false,
    this.onRepeated,
  });

  Future<void> _repeat(BuildContext context) async {
    final loaded = menu;
    final messenger = ScaffoldMessenger.of(context);
    if (loaded == null) return;

    try {
      final result = await context.read<ApiClient>().repeatOrder(order.id);
      if (!context.mounted) return;

      final added = context.read<Cart>().fillFromRepeat(result, loaded);

      // Ничего не перенеслось — это не успех, и вибрировать «успехом»
      // здесь было бы враньём.
      if (added == 0) {
        await Haptics.warning();
        messenger.showSnackBar(
          const SnackBar(content: Text('Из того заказа сегодня ничего нет')),
        );
        return;
      }

      Haptics.success();
      if (result.unavailable.isNotEmpty) {
        // О пропавших позициях сообщаем явно: молча уменьшить заказ —
        // худшее, что можно сделать с повтором.
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              result.unavailable.length == 1
                  ? '${result.unavailable.first.name} — ${result.unavailable.first.reason}'
                  : 'Не перенеслось: ${result.unavailable.map((u) => u.name).join(', ')}',
            ),
          ),
        );
      }
      onRepeated?.call();
    } catch (e) {
      await Haptics.warning();
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final ready = menu != null;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      decoration: BoxDecoration(
        // Фон страницы, а не «светлое»: карточка лежит на акцентной
        // шапке, но текст в ней — из темы. В тёмной теме светлая
        // карточка означала бы светлый текст на светлом.
        color: onDark ? colors.page : Colors.transparent,
        borderRadius: const BorderRadius.all(Radius.circular(24)),
        border: onDark ? null : Border.all(color: colors.border, width: 1.5),
      ),
      child: Row(
        children: [
          _Thumb(url: order.photoUrl, colors: colors),
          const SizedBox(width: Gap.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  order.summary,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  formatTenge(order.total),
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 15,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Gap.sm),
          PressScale(
            onTap: ready ? () => _repeat(context) : null,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
              decoration: BoxDecoration(
                // Повтор — действие, поэтому оранжевый, а не маджента:
                // выгоды в нём нет, есть быстрый путь.
                color: ready ? colors.accent : colors.fillSoft,
                borderRadius: R.pill,
              ),
              child: Text(
                'Повторить',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: ready ? colors.surface : colors.muted,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  final String? url;
  final AppColors colors;

  const _Thumb({required this.url, required this.colors});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: R.thumbRepeat,
      child: SizedBox(
        width: 44,
        height: 44,
        child: url == null || url!.isEmpty
            ? ColoredBox(color: colors.fillSoft)
            : Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => ColoredBox(color: colors.fillSoft),
              ),
      ),
    );
  }
}
