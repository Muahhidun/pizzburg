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
  Timer? _countdown;
  bool _cancelling = false;
  bool _answering = false;
  int _lastStage = -1;

  /// Только два этапа — ровно столько, сколько мы знаем на самом деле.
  ///
  /// Poster по своему API отдаёт три состояния входящего заказа: новый,
  /// принят, отклонён. Готовку, выдачу и «курьер в пути» никто не
  /// проставляет: заставлять кассира отмечать их вручную — добавить ей
  /// работы ради шкалы. Обещать клиенту этапы, до которых заказ никогда не
  /// дойдёт, хуже, чем честно сказать «принят, ждите».
  static const _stages = [
    ('NEW', 'Ждём подтверждения'),
    ('ACCEPTED', 'Готовим ваш заказ'),
  ];

  static const _headlines = {
    'NEW': 'Ждём подтверждения',
    'ACCEPTED': 'Готовим ваш заказ',
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
    // Отдельный тик на секунду — только чтобы шёл обратный отсчёт ответа
    // по нехватке позиции. Опрашивать сервер раз в секунду ради этого
    // незачем: срок известен заранее.
    _countdown = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && (_awaitingShortage || _cancelLeft != null)) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _countdown?.cancel();
    super.dispose();
  }

  /// Ждём ли ответа клиента по нехватке позиции (DECISIONS §12.9)
  bool get _awaitingShortage => _data?['shortageState'] == 'AWAITING_CUSTOMER';

  /// Сколько осталось на бесплатную отмену.
  ///
  /// Считаем до конца окна отмены, а НЕ до отправки на кухню. Между ними
  /// десять секунд буфера, и он технический: он закрывает гонку «нажал
  /// отменить ровно в момент печати чека». Показывать клиенту 69 секунд,
  /// когда кнопка умирает на 60-й, — обманывать: человек жмёт на 65-й и
  /// получает отказ, глядя на живой отсчёт.
  Duration? get _cancelLeft {
    final window = _availability?.cancelWindowMinutes ?? 0;
    if (window <= 0) return null;
    // Отсчёт живёт, только пока заказ ещё можно отменить. Раньше он
    // смотрел лишь на время, и после отмены экран ещё полминуты писал
    // «Ещё можно отменить» с бегущими секундами — человек нажал, ничего
    // не изменилось, и он идёт звонить.
    if ((_data?['status'] ?? 'NEW') != 'NEW') return null;
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    if (created == null) return null;
    final left = created
        .add(Duration(minutes: window))
        .difference(DateTime.now());
    return left.isNegative ? null : left;
  }

  List<Map> get _missingItems => ((_data?['items'] as List?) ?? const [])
      .cast<Map>()
      .where((i) => i['isUnavailable'] == true)
      .toList();

  /// Сколько осталось на ответ. null — срок неизвестен
  Duration? get _shortageLeft {
    final raw = _data?['shortageDeadline']?.toString();
    if (raw == null) return null;
    final deadline = DateTime.tryParse(raw);
    if (deadline == null) return null;
    final left = deadline.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  /// Ответ на нехватку: везём остальное или отменяем заказ целиком
  Future<void> _answerShortage({required bool keep}) async {
    setState(() => _answering = true);
    final messenger = ScaffoldMessenger.of(context);
    final api = context.read<ApiClient>();
    try {
      if (keep) {
        await api.keepOrderWithoutMissing(widget.order.id);
      } else {
        await api.cancelOrderForShortage(widget.order.id);
        await LastPlacedOrder.forget();
      }
      await _load();
      if (mounted) Haptics.success();
    } catch (e) {
      await Haptics.warning();
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _answering = false);
    }
  }

  Future<void> _load() async {
    final api = context.read<ApiClient>();
    // Сначала подтягиваем состояние из Poster, потом читаем заказ: иначе
    // экран показывает снимок базы, который мог отстать на круг опроса.
    // Молча переживаем неудачу — заказ всё равно покажем, просто прежним.
    // Завершённый заказ Poster уже не изменит: синк для него — лишний
    // запрос и лишняя задержка при открытии из истории.
    final known = _data?['status']?.toString();
    if (known != 'DELIVERED' && known != 'CANCELLED') {
      try {
        await api.syncOrderStatus(widget.order.id);
      } catch (_) {}
    }
    try {
      final data = await api.orderStatus(widget.order.id);
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
    // Пока ответ не пришёл, статуса мы не знаем. Раньше здесь стояло NEW
    // по умолчанию, и любой заказ — даже отменённый неделю назад — на
    // первую секунду показывался как «Заказ отправлен». Выглядело так,
    // будто история пересчитывается заново при каждом открытии.
    final loaded = _data != null;
    final status = _data?['status']?.toString() ?? 'NEW';
    final current = _stageIndex(status);
    final cancelled = status == 'CANCELLED';

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarBrightness: Brightness.dark,
        statusBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: c.panel,
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
                loaded
                    ? (_awaitingShortage
                          ? 'Одной позиции не оказалось'
                          : _cancelLeft != null
                          ? 'Ещё можно отменить'
                          : (_headlines[status] ?? status))
                    : 'Загружаем…',
                style: Theme.of(context).textTheme.displayMedium?.copyWith(
                  color: loaded
                      ? c.surface
                      : c.surface.withValues(alpha: 0.35),
                ),
              ),

              if (_awaitingShortage) _shortageChoice(),

              // Пока заказ не ушёл на кухню, говорим об этом прямо.
              // «Заказ отправлен» в эти секунды было бы неправдой, а
              // человек как раз в них решает, передумал он или нет.
              if (!_awaitingShortage && _cancelLeft != null) ...[
                Padding(
                  padding: const EdgeInsets.only(top: Gap.md),
                  child: Text(
                    'Отменить без последствий можно ещё '
                    '${_cancelLeft!.inSeconds} с — заведение о заказе пока '
                    'не знает.',
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.45,
                      color: c.surface.withValues(alpha: 0.75),
                    ),
                  ),
                ),
                // Кнопка отмены стоит здесь, а не внизу под составом:
                // окно живёт минуту, и пролистывать до главного действия
                // в эту минуту человек не должен.
                if (_canCancel) ...[
                  const SizedBox(height: Gap.md),
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
                ],
              ],

              if (loaded && !cancelled) ...[
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
                        color: c.onBenefit,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 28),

                for (var i = 0; i < _stages.length; i++)
                  _StageRow(
                    label: _stages[i].$2,
                    // Последний этап на шкале — «принят кухней», и дальше
                    // мы не узнаём ничего. Пока правило было «галочка у
                    // всего, что позади текущего», он навсегда оставался
                    // кольцом: за ним просто нет следующего этапа. Для
                    // человека это читается как незавершённое действие,
                    // хотя кухня заказ уже подтвердила.
                    done:
                        i < current ||
                        (i == current && i == _stages.length - 1),
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
                          // Снятую позицию не убираем из списка, а гасим:
                          // человек должен видеть, чего именно не будет,
                          // а не гадать, куда делась строка.
                          final gone = item['isUnavailable'] == true;
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
                                      color: c.surface.withValues(
                                        alpha: gone ? 0.45 : 1,
                                      ),
                                      decoration: gone
                                          ? TextDecoration.lineThrough
                                          : null,
                                      decorationColor: c.surface.withValues(
                                        alpha: 0.45,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: Gap.sm),
                                Text(
                                  gone
                                      ? 'нет в наличии'
                                      : gift
                                      ? 'подарок'
                                      : formatTenge(
                                          ((item['price'] as num?) ?? 0)
                                                  .toInt() *
                                              qty,
                                        ),
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                    color: gone
                                        ? c.surface.withValues(alpha: 0.45)
                                        : gift
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
                    // Сумму берём из ответа сервера, а не из карточки
                    // оформления: после нехватки позиции заказ дешевеет,
                    // и старая цифра тут была бы прямым обманом.
                    Text(
                      formatTenge(
                        ((_data?['total'] as num?) ?? widget.order.total)
                            .toInt(),
                      ),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontSize: 17,
                        color: c.surface,
                      ),
                    ),
                  ],
                ),
              ),

              if (_canCancel && _cancelLeft == null) ...[
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

  /// Выбор клиента при нехватке позиции (DECISIONS §12.9).
  ///
  /// Вариантов ровно два, и оба честные: замен на первом этапе нет.
  /// Обратный отсчёт показываем прямо здесь — молчание тоже решение, и
  /// человек должен знать, каким оно будет.
  Widget _shortageChoice() {
    final c = context.colors;
    final left = _shortageLeft;
    final names = _missingItems
        .map((i) {
          final qty = (i['qty'] as num?)?.toInt() ?? 1;
          return '${i['name']}${qty > 1 ? ' ×$qty' : ''}';
        })
        .join(', ');

    return Padding(
      padding: const EdgeInsets.only(top: Gap.lg),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: c.surface.withValues(alpha: 0.1),
          borderRadius: R.thumb,
          border: Border.all(color: c.accent.withValues(alpha: 0.7), width: 1.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              names.isEmpty ? 'Позиции нет в наличии' : 'Нет: $names',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.35,
                color: c.surface,
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              'Остальное уже готовится. Везём без этой позиции — или отменяем '
              'заказ целиком?',
              style: TextStyle(
                fontSize: 13.5,
                height: 1.45,
                color: c.surface.withValues(alpha: 0.75),
              ),
            ),
            if (left != null) ...[
              const SizedBox(height: Gap.sm),
              Text(
                left == Duration.zero
                    ? 'Время вышло — сейчас оформим доставку остального'
                    : 'Если не ответите за ${left.inMinutes}:'
                          '${(left.inSeconds % 60).toString().padLeft(2, '0')}, '
                          'привезём остальное',
                style: TextStyle(
                  fontSize: 12.5,
                  height: 1.4,
                  color: c.surface.withValues(alpha: 0.5),
                ),
              ),
            ],
            const SizedBox(height: Gap.lg),
            PressScale(
              onTap: _answering ? null : () => _answerShortage(keep: true),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 15),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.benefit, borderRadius: R.pill),
                child: Text(
                  _answering ? 'Секунду…' : 'Везите без неё',
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: c.onBenefit,
                  ),
                ),
              ),
            ),
            const SizedBox(height: Gap.sm),
            PressScale(
              onTap: _answering ? null : () => _answerShortage(keep: false),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 15),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: R.pill,
                  border: Border.all(color: c.surface.withValues(alpha: 0.3)),
                ),
                child: Text(
                  'Отменить заказ целиком',
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
    );
  }

  String _summary() {
    final items = ((_data?['items'] as List?) ?? const [])
        .cast<Map>()
        // Снятые позиции в счёт не идут: «5 поз.» при четырёх приехавших
        .where((i) => i['isUnavailable'] != true);
    final count = items.fold<int>(
      0,
      (sum, i) => sum + ((i['qty'] as num?) ?? 0).toInt(),
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
                  ? Icon(Icons.check, size: 14, color: c.onBenefit)
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
      decoration: BoxDecoration(color: c.page, borderRadius: R.sheetTop),
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
                      color: _selected == reason.id ? c.panel : c.fillSoft,
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
