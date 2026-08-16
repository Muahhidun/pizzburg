import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';

/// Статус заказа. Экран целиком тёмный — по прототипу «Сигнал».
///
/// Тёмный фон здесь не украшение: это единственный экран, который человек
/// открывает в ожидании и держит открытым. Он должен читаться как отдельное
/// состояние приложения, а не как ещё одна страница каталога.
class OrderScreen extends StatefulWidget {
  final CreatedOrder order;
  const OrderScreen({super.key, required this.order});

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  Map<String, dynamic>? _data;
  Availability? _availability;
  Timer? _timer;
  bool _cancelling = false;
  int _lastStage = -1;

  /// Только два этапа — ровно столько, сколько мы знаем на самом деле.
  ///
  /// Poster по своему API отдаёт три состояния входящего заказа: новый,
  /// принят, отклонён. Готовку, выдачу и «курьер в пути» никто не
  /// проставляет: заставлять кассира отмечать их вручную — добавить ей
  /// работы ради шкалы. Обещать клиенту этапы, до которых заказ никогда не
  /// дойдёт, хуже, чем честно сказать «принят, ждите».
  static const _stages = [
    ('NEW', 'Заказ отправлен'),
    ('ACCEPTED', 'Принят кухней'),
  ];

  static const _headlines = {
    'NEW': 'Заказ отправлен',
    'ACCEPTED': 'Принят кухней',
    'COOKING': 'Готовим ваш заказ',
    'READY': 'Готов к выдаче',
    'ON_WAY': 'Курьер в пути',
    'DELIVERED': 'Заказ доставлен',
    'CANCELLED': 'Заказ отменён',
  };

  @override
  void initState() {
    super.initState();
    _load();
    _loadAvailability();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().orderStatus(widget.order.id);
      if (!mounted) return;
      final stage = _stageIndex(data['status']?.toString() ?? 'NEW');
      // Переход на следующий этап — маджентовый момент: он единственный,
      // ради чего этот экран держат открытым.
      if (_lastStage >= 0 && stage > _lastStage) Haptics.success();
      _lastStage = stage;
      setState(() => _data = data);
      if (data['status'] == 'DELIVERED' || data['status'] == 'CANCELLED') {
        await LastPlacedOrder.forget();
      }
    } catch (_) {
      // попробуем на следующем тике
    }
  }

  Future<void> _loadAvailability() async {
    try {
      final a = await context.read<ApiClient>().fetchAvailability();
      if (mounted) setState(() => _availability = a);
    } catch (_) {}
  }

  int _stageIndex(String status) {
    if (status == 'NEW') return 0;
    // Всё, что дальше приёма, показываем как «принят»: кухня и доставка до
    // нас не отчитываются, а откатывать шкалу назад нельзя.
    return 1;
  }

  bool get _canCancel {
    final window = _availability?.cancelWindowMinutes ?? 0;
    if (window <= 0) return false;
    if (!context.read<AuthState>().isAuthenticated) return false;
    if ((_data?['status'] ?? 'NEW') != 'NEW') return false;
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    if (created == null) return false;
    return DateTime.now().isBefore(created.add(Duration(minutes: window)));
  }

  Future<void> _cancel() async {
    final choice = await showModalBottomSheet<_CancelChoice>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => const _CancelSheet(),
    );
    if (choice == null || !mounted) return;
    setState(() => _cancelling = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiClient>().cancelOrder(
        widget.order.id,
        reasonId: choice.reasonId,
      );
      await LastPlacedOrder.forget();
      await _load();
      if (mounted) Haptics.success();
    } catch (e) {
      await Haptics.warning();
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final status = _data?['status']?.toString() ?? 'NEW';
    final current = _stageIndex(status);
    final cancelled = status == 'CANCELLED';

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarBrightness: Brightness.dark,
        statusBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: c.ink,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Gap.screen,
              Gap.md,
              Gap.screen,
              Gap.blockWide,
            ),
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
                        color: c.surface.withValues(alpha: 0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.arrow_back,
                        size: 18,
                        color: c.surface,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Gap.blockWide),

              Text(
                'Заказ № ${widget.order.number}',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  color: c.surface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: Gap.sm),
              Text(
                _headlines[status] ?? status,
                style: Theme.of(
                  context,
                ).textTheme.displayMedium?.copyWith(color: c.surface),
              ),

              if (!cancelled) ...[
                const SizedBox(height: Gap.lg),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: c.benefit,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      status == 'DELIVERED' ? 'доставлен' : 'в работе',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontSize: 15.5,
                        color: c.ink,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 28),

                for (var i = 0; i < _stages.length; i++)
                  _StageRow(
                    label: _stages[i].$2,
                    done: i < current,
                    active: i == current,
                    isLast: i == _stages.length - 1,
                  ),

                // Дальше шкалы нет, поэтому вместо неё — что будет
                // происходить. Пустое ожидание без объяснения читается как
                // «о заказе забыли».
                if (current >= 1) ...[
                  const SizedBox(height: 18),
                  Text(
                    _data?['type'] == 'PICKUP'
                        ? 'Заказ приняли и готовят. Мы позвоним, когда его можно будет забрать.'
                        : 'Заказ приняли и готовят. Как только он будет готов, курьер привезёт его и занесёт до двери.',
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.45,
                      color: c.surface.withValues(alpha: 0.75),
                    ),
                  ),
                ],
              ],

              const SizedBox(height: 28),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: c.surface.withValues(alpha: 0.1),
                  borderRadius: R.thumb,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _summary(),
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.5,
                        color: c.surface.withValues(alpha: 0.75),
                      ),
                    ),
                    // Состав заказа: без него экран статуса сообщает сумму
                    // и больше ничего — проверить, что именно едет, негде,
                    // и при частичной отмене человеку не с чем сверяться.
                    for (final raw in (_data?['items'] as List?) ?? const [])
                      Builder(
                        builder: (_) {
                          final item = raw as Map;
                          final qty = (item['qty'] as num?)?.toInt() ?? 1;
                          final gift = item['isGift'] == true;
                          return Padding(
                            padding: const EdgeInsets.only(top: Gap.sm),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    '${item['name']}${qty > 1 ? ' ×$qty' : ''}',
                                    style: TextStyle(
                                      fontSize: 13.5,
                                      height: 1.35,
                                      color: c.surface,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: Gap.sm),
                                Text(
                                  gift
                                      ? 'подарок'
                                      : formatTenge(
                                          ((item['price'] as num?) ?? 0)
                                                  .toInt() *
                                              qty,
                                        ),
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                    color: gift
                                        ? c.benefit
                                        : c.surface.withValues(alpha: 0.85),
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    const SizedBox(height: Gap.md),
                    Text(
                      formatTenge(widget.order.total),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontSize: 17,
                        color: c.surface,
                      ),
                    ),
                  ],
                ),
              ),

              if (_canCancel) ...[
                const SizedBox(height: Gap.lg),
                PressScale(
                  onTap: _cancelling ? null : _cancel,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: R.pill,
                      border: Border.all(
                        color: c.surface.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Text(
                      _cancelling ? 'Отменяем…' : 'Отменить заказ',
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: c.surface,
                      ),
                    ),
                  ),
                ),
              ] else if (!cancelled && current >= 3) ...[
                const SizedBox(height: Gap.lg),
                Text(
                  'Отмена недоступна — заказ уже у курьера',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: c.surface.withValues(alpha: 0.5),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _summary() {
    final items = (_data?['items'] as List?) ?? const [];
    final count = items.fold<int>(
      0,
      (sum, i) => sum + ((i as Map)['qty'] as num).toInt(),
    );
    final type = _data?['type'] == 'PICKUP' ? 'Самовывоз' : 'Доставка';
    return count == 0 ? type : '$count поз. · $type';
  }
}

class _StageRow extends StatelessWidget {
  final String label;
  final bool done;
  final bool active;
  final bool isLast;

  const _StageRow({
    required this.label,
    required this.done,
    required this.active,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final dim = !done && !active;

    return Opacity(
      opacity: dim ? 0.45 : 1,
      child: Padding(
        padding: EdgeInsets.only(bottom: isLast ? 0 : Gap.lg),
        child: Row(
          children: [
            AnimatedContainer(
              duration: Motion.slow,
              curve: Motion.benefit,
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: done ? c.benefit : Colors.transparent,
                shape: BoxShape.circle,
                border: done
                    ? null
                    : Border.all(
                        color: active
                            ? c.benefit
                            : c.surface.withValues(alpha: 0.45),
                        width: active ? 2 : 1.5,
                      ),
              ),
              child: done
                  ? Icon(Icons.check, size: 14, color: c.ink)
                  : null,
            ),
            const SizedBox(width: Gap.md),
            Text(
              label,
              style: TextStyle(
                fontSize: 14.5,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color: c.surface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CancelChoice {
  final String? reasonId;
  const _CancelChoice({this.reasonId});
}

/// Отмена с причиной — белый bottom sheet поверх тёмного экрана.
class _CancelSheet extends StatefulWidget {
  const _CancelSheet();

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  List<CancelReason>? _reasons;
  String? _selected;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await context.read<ApiClient>().fetchCancelReasons();
      if (mounted) setState(() => _reasons = list);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final reasons = _reasons;

    return Container(
      padding: EdgeInsets.fromLTRB(
        Gap.screen,
        Gap.blockWide,
        Gap.screen,
        Gap.blockWide + MediaQuery.viewInsetsOf(context).bottom,
      ),
      decoration: BoxDecoration(color: c.surface, borderRadius: R.sheetTop),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Почему отменяете?',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontSize: 21),
          ),
          const SizedBox(height: Gap.lg),
          if (_error != null)
            Text(_error!, style: TextStyle(color: c.accent, fontSize: 13))
          else if (reasons == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: Gap.block),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            for (final reason in reasons)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.sm),
                child: PressScale.selection(
                  onTap: () => setState(() => _selected = reason.id),
                  child: AnimatedContainer(
                    duration: Motion.base,
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: Gap.lg,
                      vertical: 14,
                    ),
                    decoration: BoxDecoration(
                      color: _selected == reason.id ? c.ink : c.fillSoft,
                      borderRadius: R.field,
                    ),
                    child: Text(
                      reason.label,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: _selected == reason.id ? c.surface : c.ink,
                      ),
                    ),
                  ),
                ),
              ),
          const SizedBox(height: Gap.md),
          PressScale(
            onTap: _selected == null
                ? null
                : () => Navigator.pop(
                    context,
                    _CancelChoice(reasonId: _selected),
                  ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: _selected == null ? c.fillSoft : c.accent,
                borderRadius: R.pill,
              ),
              child: Text(
                'Отменить заказ',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: _selected == null ? c.muted : c.surface,
                ),
              ),
            ),
          ),
          const SizedBox(height: Gap.sm),
          PressScale(
            onTap: () => Navigator.pop(context),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: c.fillSoft,
                borderRadius: R.pill,
              ),
              child: Text(
                'Оставить заказ',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: c.ink,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
