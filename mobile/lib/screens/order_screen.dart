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
import '../i18n/strings.dart';

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
  static List<(String, String)> get _stages => [
    ('NEW', S.statusNew),
    ('ACCEPTED', S.statusCooking),
  ];

  static Map<String, String> get _headlines => {
    'NEW': S.statusNew,
    'ACCEPTED': S.statusCooking,
    'COOKING': S.statusCooking,
    'READY': S.statusReadyPickup,
    'ON_WAY': S.statusOnWay,
    'DELIVERED': S.statusDelivered,
    'CANCELLED': S.statusCancelledOrder,
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
      // Сюда же обратный отсчёт паузы между обращениями: он тикает
      // локально, срок известен заранее, сервер дёргать незачем.
      if (mounted &&
          (_awaitingShortage || _cancelLeft != null || _messageWait != null)) {
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
    final explicit = DateTime.tryParse(
      _data?['cancelUntil']?.toString() ?? '',
    );
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    final deadline = explicit ?? created?.add(Duration(minutes: window));
    if (deadline == null) return null;
    final left = deadline.difference(DateTime.now());
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
      setState(() {
        _data = data;
        _loadError = null;
        final state = data['messages'];
        if (state is Map<String, dynamic>) _messageState = state;
      });
      if (data['status'] == 'DELIVERED' || data['status'] == 'CANCELLED') {
        await LastPlacedOrder.forget();
      }
    } catch (e) {
      // Пока заказ уже показан, молчим: следующий тик перечитает. А вот
      // если показывать нечего — говорим прямо, иначе экран врёт, что
      // всё ещё грузится.
      if (mounted && _data == null) {
        setState(
          () => _loadError = e.toString().replaceFirst('Exception: ', ''),
        );
      }
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

  bool _sendingMessage = false;

  /// Почему не удалось прочитать заказ.
  ///
  /// Раньше ошибка глоталась молча, и экран навсегда застревал на
  /// «Загружаем…». Так спряталась целая регрессия: запрос статуса
  /// перестал слать токен, все ответы стали 401, а выглядело это как
  /// вечная загрузка.
  String? _loadError;

  /// Сколько обращений уже отправлено и когда можно снова.
  ///
  /// Приходит вместе со статусом заказа: кнопка должна знать своё
  /// состояние до нажатия, а не узнавать об отказе после (§12.21).
  Map<String, dynamic>? _messageState;

  int get _messagesSent =>
      (_messageState?['sent'] as num?)?.toInt() ?? 0;
  int get _messagesLimit =>
      (_messageState?['limit'] as num?)?.toInt() ?? 3;

  /// Сколько ещё ждать до следующего обращения; null — можно писать
  Duration? get _messageWait {
    final at = DateTime.tryParse(
      _messageState?['nextAllowedAt']?.toString() ?? '',
    );
    if (at == null) return null;
    final left = at.difference(DateTime.now());
    return left.isNegative ? null : left;
  }

  bool get _messagesExhausted => _messagesSent >= _messagesLimit;

  bool get _canCancel {
    final window = _availability?.cancelWindowMinutes ?? 0;
    if (window <= 0) return false;
    if (!context.read<AuthState>().isAuthenticated) return false;
    if ((_data?['status'] ?? 'NEW') != 'NEW') return false;
    final explicit = DateTime.tryParse(
      _data?['cancelUntil']?.toString() ?? '',
    );
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    final deadline = explicit ?? created?.add(Duration(minutes: window));
    return deadline != null && DateTime.now().isBefore(deadline);
  }

  /// Заказ ещё живой — по нему есть о чём писать.
  ///
  /// Закрытый обсуждать поздно: смена его уже не видит, и впечатления
  /// соберёт анкета качества.
  bool get _isLive {
    final status = _data?['status'] ?? 'NEW';
    return status != 'DELIVERED' && status != 'CANCELLED';
  }

  /// Написать в заведение (DECISIONS §12.21).
  ///
  /// Сначала тема из списка, потом — по желанию — пара слов. Кассир
  /// читает это в разгар смены: помеченный запрос она разбирает за
  /// секунду, абзац свободного текста — нет. Ровно этим кнопка и лучше
  /// звонка, из-за которого телефон и не публикуется.
  Future<void> _writeUs() async {
    final choice = await showModalBottomSheet<_MessageChoice>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _MessageSheet(),
    );
    if (choice == null || !mounted) return;

    setState(() => _sendingMessage = true);
    try {
      final state = await context.read<ApiClient>().sendOrderMessage(
        widget.order.id,
        topic: choice.topic,
        text: choice.text,
      );
      if (!mounted) return;
      setState(() => _messageState = state);
      Haptics.success();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(S.passedToCashier)),
      );
    } catch (e) {
      if (!mounted) return;
      await Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _sendingMessage = false);
    }
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
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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
                S.orderNo(widget.order.number),
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
                          ? S.onePositionMissing
                          : _cancelLeft != null
                          ? S.canStillCancel
                          : (_headlines[status] ?? status))
                    : _loadError != null
                    ? S.loadFailed
                    : S.loading,
                style: Theme.of(context).textTheme.displayMedium?.copyWith(
                  color: loaded
                      ? c.surface
                      : c.surface.withValues(alpha: 0.35),
                ),
              ),

              if (!loaded && _loadError != null) ...[
                const SizedBox(height: Gap.md),
                Text(
                  _loadError!,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.4,
                    color: c.surface.withValues(alpha: 0.7),
                  ),
                ),
                const SizedBox(height: Gap.lg),
                PressScale(
                  onTap: () {
                    setState(() => _loadError = null);
                    _load();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: R.pill,
                      border: Border.all(
                        color: c.surface.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Text(
                      S.retry,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: c.surface,
                      ),
                    ),
                  ),
                ),
              ],

              if (_awaitingShortage) _shortageChoice(),

              // Пока заказ не ушёл на кухню, говорим об этом прямо.
              // «Заказ отправлен» в эти секунды было бы неправдой, а
              // человек как раз в них решает, передумал он или нет.
              if (!_awaitingShortage && _cancelLeft != null) ...[
                Padding(
                  padding: const EdgeInsets.only(top: Gap.md),
                  child: Text(
                    S.cancelWindowLeft(_cancelLeft!.inSeconds),
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
                        _cancelling ? S.cancelling : S.cancelOrder,
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
                      status == 'DELIVERED' ? S.deliveredLower : S.inProgressLower,
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
                        ? S.acceptedPickupHint
                        : S.acceptedDeliveryHint,
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
                                      ? S.outOfStockLower
                                      : gift
                                      ? S.giftLower
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

              // «Написать нам» — замена телефона кассы, поэтому стоит на
              // экране заказа и видна, пока заказ живой. Это единственный
              // канал, по которому человек может сказать «не тот адрес»
              // или «забыли соус», пока это ещё можно исправить.
              if (_isLive) ...[
                const SizedBox(height: Gap.lg),
                _WriteUsButton(
                  sending: _sendingMessage,
                  wait: _messageWait,
                  sent: _messagesSent,
                  limit: _messagesLimit,
                  exhausted: _messagesExhausted,
                  onTap: _writeUs,
                ),
              ],

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
                      _cancelling ? S.cancelling : S.cancelOrder,
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
                  S.cancelUnavailableCourier,
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
              names.isEmpty ? S.positionsMissing : S.missingList(names),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.35,
                color: c.surface,
              ),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              S.shortageQuestion,
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
                    ? S.shortageTimeUp
                    : S.shortageCountdown(
                        left.inMinutes,
                        (left.inSeconds % 60).toString().padLeft(2, '0'),
                      ),
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
                  _answering ? S.oneSecond : S.bringWithoutIt,
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
                  S.cancelWholeOrder,
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
    final type = _data?['type'] == 'PICKUP' ? S.pickup : S.delivery;
    return count == 0 ? type : S.positionsShort(count, type);
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

/// Кнопка «Написать нам» со своим состоянием.
///
/// Три вида: можно писать, идёт пауза, обращений больше нет. Молча
/// гасить кнопку нельзя — человек решит, что приложение сломалось; и
/// нельзя оставлять её рабочей — тогда он получит отказ на действие,
/// которое мы сами предложили.
class _WriteUsButton extends StatelessWidget {
  final bool sending;
  final Duration? wait;
  final int sent;
  final int limit;
  final bool exhausted;
  final VoidCallback onTap;

  const _WriteUsButton({
    required this.sending,
    required this.wait,
    required this.sent,
    required this.limit,
    required this.exhausted,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final blocked = exhausted || wait != null;

    final label = sending
        ? S.sending
        : exhausted
        ? S.weGotYourMessages
        : wait != null
        ? S.writeAgainIn(_left(wait!))
        : sent > 0
        ? S.writeMore
        : S.writeToUs;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PressScale(
          onTap: sending || blocked ? null : onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 15),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: R.pill,
              color: c.surface.withValues(alpha: blocked ? 0.04 : 0.10),
              border: Border.all(
                color: c.surface.withValues(alpha: blocked ? 0.12 : 0.3),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  exhausted
                      ? Icons.check_circle_outline
                      : wait != null
                      ? Icons.schedule
                      : Icons.chat_bubble_outline,
                  size: 16,
                  color: c.surface.withValues(alpha: blocked ? 0.5 : 1),
                ),
                const SizedBox(width: Gap.sm),
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: c.surface.withValues(alpha: blocked ? 0.5 : 1),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (sent > 0) ...[
          const SizedBox(height: Gap.sm),
          Text(
            exhausted
                ? S.cashierSeesThem
                : S.sentOf(sent, limit),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color: c.surface.withValues(alpha: 0.6),
            ),
          ),
        ],
      ],
    );
  }

  static String _left(Duration d) {
    final total = d.inSeconds;
    final minutes = total ~/ 60;
    final seconds = total % 60;
    if (minutes == 0) return S.secondsShort(seconds);
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

/// Тема и, по желанию, пара слов
class _MessageChoice {
  final String topic;
  final String? text;
  const _MessageChoice({required this.topic, this.text});
}

/// Написать в заведение: тема из списка, затем свободное поле.
///
/// Список, а не пустое поле: кассир читает это в разгар смены, и
/// помеченный запрос она разбирает за секунду. Поле для текста
/// необязательное — «где мой заказ» сказано уже самой темой.
class _MessageSheet extends StatefulWidget {
  const _MessageSheet();

  @override
  State<_MessageSheet> createState() => _MessageSheetState();
}

class _MessageSheetState extends State<_MessageSheet> {
  static List<(String, String)> get _topics => [
    ('WHERE', S.topicWhere),
    ('ADDRESS', S.topicAddress),
    ('CANCEL', S.cancelOrder),
    ('MISSING', S.topicMissing),
    ('OTHER', S.topicOther),
  ];

  String? _topic;
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    // «Другое» без пояснения — пустое сообщение, разбирать в нём нечего
    final ready = _topic != null && (_topic != 'OTHER' || _text.text.trim().isNotEmpty);

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
            S.whatHappened,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontSize: 21),
          ),
          const SizedBox(height: Gap.xs),
          Text(
            S.willPassWithOrderNumber,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: Gap.lg),
          for (final (id, label) in _topics)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.sm),
              child: PressScale.selection(
                onTap: () => setState(() => _topic = id),
                child: AnimatedContainer(
                  duration: Motion.base,
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: Gap.lg,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: _topic == id ? c.panel : c.fillSoft,
                    borderRadius: R.field,
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: _topic == id ? c.surface : c.ink,
                    ),
                  ),
                ),
              ),
            ),
          const SizedBox(height: Gap.sm),
          TextField(
            controller: _text,
            maxLines: 2,
            maxLength: 500,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: _topic == 'OTHER'
                  ? S.tellWhatIsWrong
                  : S.fewWordsIfNeeded,
              counterText: '',
              filled: true,
              fillColor: c.fillSoft,
              border: OutlineInputBorder(
                borderRadius: R.field,
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: Gap.md),
          PressScale(
            onTap: ready
                ? () => Navigator.pop(
                    context,
                    _MessageChoice(topic: _topic!, text: _text.text),
                  )
                : null,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: ready ? c.accent : c.fillSoft,
                borderRadius: R.pill,
              ),
              child: Text(
                S.send,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: ready ? c.surface : c.muted,
                ),
              ),
            ),
          ),
        ],
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
            S.whyCancelling,
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
                S.cancelOrder,
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
                S.keepOrder,
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
