import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'order_screen.dart';
import '../i18n/strings.dart';

/// Экран «Заказы»: активный заказ крупно, ниже история с повтором.
///
/// Активный вынесен наверх отдельной тёмной карточкой, потому что это
/// единственное, ради чего сюда заходят в момент ожидания: «где мой заказ».
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  static Map<String, String> get _stageLabels => {
    'NEW': S.statusNew,
    'ACCEPTED': S.statusCooking,
    'COOKING': S.statusCooking,
    'READY': S.statusReady,
    'ON_WAY': S.statusOnWay,
    'DELIVERED': S.statusDelivered,
    'CANCELLED': S.statusCancelled,
  };

  static const _active = {'NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'};

  MenuResponse? _menu;

  @override
  void initState() {
    super.initState();
    // Меню нужно для повтора: корзина собирается по текущим ценам
    context.read<ApiClient>().fetchMenu().then((menu) {
      if (mounted) setState(() => _menu = menu);
    }).catchError((_) => null);
  }

  Future<void> _repeat(Map<String, dynamic> order) async {
    final loaded = _menu;
    final messenger = ScaffoldMessenger.of(context);
    if (loaded == null) return;
    try {
      final result = await context.read<ApiClient>().repeatOrder(
        order['id'].toString(),
      );
      if (!mounted) return;
      final added = context.read<Cart>().fillFromRepeat(result, loaded);
      if (added == 0) {
        await Haptics.warning();
        messenger.showSnackBar(
          SnackBar(content: Text(S.nothingFromThatOrder)),
        );
        return;
      }
      Haptics.success();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            result.unavailable.isEmpty
                ? S.orderMovedToCart
                : S.notMoved(
                    result.unavailable.map((u) => u.name).join(', '),
                  ),
          ),
        ),
      );
    } catch (e) {
      await Haptics.warning();
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _open(Map<String, dynamic> order) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => OrderScreen(
          order: CreatedOrder(
            id: order['id'].toString(),
            number: (order['number'] as num).toInt(),
            total: (order['total'] as num?)?.toInt() ?? 0,
            pointsSpent: (order['pointsSpent'] as num?)?.toInt() ?? 0,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final auth = context.watch<AuthState>();
    final orders = auth.orders.cast<Map<String, dynamic>>();
    final active = orders
        .where((o) => _active.contains(o['status']?.toString()))
        .toList();
    final history = orders
        .where((o) => !_active.contains(o['status']?.toString()))
        .toList();

    return Scaffold(
      backgroundColor: colors.page,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: auth.refresh,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              Gap.screen,
              Gap.lg,
              Gap.screen,
              // Плавающий бар лежит поверх списка
              Gap.navBarSpace(context),
            ),
            children: [
              Text(S.orders, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: Gap.block),

              if (!auth.isAuthenticated)
                Text(
                  S.signInToSeeOrders,
                  style: Theme.of(context).textTheme.bodySmall,
                )
              else if (orders.isEmpty)
                Text(
                  S.noOrdersYet,
                  style: Theme.of(context).textTheme.bodySmall,
                ),

              for (final order in active)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.md),
                  child: _ActiveCard(
                    order: order,
                    stage: _stageLabels[order['status']?.toString()] ?? '',
                    onTap: () => _open(order),
                  ),
                ),

              if (history.isNotEmpty) ...[
                const SizedBox(height: Gap.sm),
                for (var i = 0; i < history.length; i++)
                  StaggeredEntrance(
                    index: i,
                    child: _HistoryRow(
                      order: history[i],
                      canRepeat: _menu != null,
                      onRepeat: () => _repeat(history[i]),
                      onTap: () => _open(history[i]),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveCard extends StatelessWidget {
  final Map<String, dynamic> order;
  final String stage;
  final VoidCallback onTap;

  const _ActiveCard({
    required this.order,
    required this.stage,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = (order['items'] as List?) ?? const [];
    final positions = items.fold<int>(
      0,
      (sum, i) => sum + ((i as Map)['qty'] as num).toInt(),
    );

    return PressScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: c.panel, borderRadius: R.block),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              S.activeOrder('${order['number']}'),
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: c.surface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              stage,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontSize: 20,
                height: 1.15,
                color: c.surface,
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              '$positions ${S.positions(positions)} · ${formatTenge((order['total'] as num?)?.toInt() ?? 0)}',
              style: TextStyle(
                fontSize: 13,
                color: c.surface.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }

}

class _HistoryRow extends StatelessWidget {
  final Map<String, dynamic> order;
  final bool canRepeat;
  final VoidCallback onRepeat;
  final VoidCallback onTap;

  const _HistoryRow({
    required this.order,
    required this.canRepeat,
    required this.onRepeat,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = (order['items'] as List?) ?? const [];
    final summary = items.map((i) => (i as Map)['name'].toString()).join(', ');

    return PressScale(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: Gap.md),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: c.line)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _date(order['createdAt']),
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    summary,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                  // Чем закончился заказ, видно по списку без открытия:
                  // отменённый и завершённый выглядели одинаково, а
                  // разница между ними для человека самая важная.
                  const SizedBox(height: 5),
                  Builder(
                    builder: (_) {
                      final cancelled = order['status'] == 'CANCELLED';
                      return Text(
                        cancelled ? S.statusCancelled : S.finished,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: cancelled ? c.danger : c.muted,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(width: Gap.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatTenge((order['total'] as num?)?.toInt() ?? 0),
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: Gap.sm),
                PressScale(
                  onTap: canRepeat ? onRepeat : null,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: c.fillSoft,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      S.repeat,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: canRepeat ? c.ink : c.muted,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    return '${date.day} ${S.months[date.month - 1]}';
  }
}
