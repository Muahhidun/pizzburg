import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';

/// Экран статуса заказа. FCM возвращает клиента сюда при нажатии на пуш,
/// а редкий polling остаётся страховкой при отключённых уведомлениях.
class OrderScreen extends StatefulWidget {
  final CreatedOrder order;
  const OrderScreen({super.key, required this.order});

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  Map<String, dynamic>? _data;
  Timer? _timer;
  Availability? _availability;
  bool _cancelling = false;

  static const _statusLabels = {
    'NEW': 'Отправлен на кухню',
    'ACCEPTED': 'Принят',
    'COOKING': 'Готовится',
    'READY': 'Готов',
    'ON_WAY': 'В пути',
    'DELIVERED': 'Доставлен',
    'CANCELLED': 'Отменён',
  };

  static const _steps = ['NEW', 'ACCEPTED', 'COOKING', 'ON_WAY', 'DELIVERED'];

  @override
  void initState() {
    super.initState();
    _load();
    _loadAvailability();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  Future<void> _loadAvailability() async {
    try {
      final a = await context.read<ApiClient>().fetchAvailability();
      if (mounted) setState(() => _availability = a);
    } catch (_) {
      // без окна отмены кнопку просто не покажем
    }
  }

  /// Клиент отменяет сам, только пока заказ не принят кассиром и не вышло
  /// окно арендатора. Те же правила проверяет сервер — здесь они лишь
  /// затем, чтобы не показывать кнопку, которая заведомо откажет.
  bool get _canCancel {
    final window = _availability?.cancelWindowMinutes ?? 0;
    if (window <= 0) return false;
    if (!context.read<AuthState>().isAuthenticated) return false;
    if ((_data?['status'] ?? 'NEW') != 'NEW') return false;
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    if (created == null) return false;
    return DateTime.now().isBefore(
      created.add(Duration(minutes: window)),
    );
  }

  int get _minutesLeft {
    final window = _availability?.cancelWindowMinutes ?? 0;
    final created = DateTime.tryParse(_data?['createdAt']?.toString() ?? '');
    if (created == null) return 0;
    final left = created
        .add(Duration(minutes: window))
        .difference(DateTime.now())
        .inMinutes;
    return left < 0 ? 0 : left;
  }

  Future<void> _cancel() async {
    final reasons = await showDialog<_CancelChoice>(
      context: context,
      builder: (_) => const _CancelDialog(),
    );
    if (reasons == null || !mounted) return;
    setState(() => _cancelling = true);
    try {
      await context.read<ApiClient>().cancelOrder(
        widget.order.id,
        reasonId: reasons.reasonId,
        reason: reasons.comment,
      );
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Заказ отменён')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().orderStatus(widget.order.id);
      if (mounted) setState(() => _data = data);
    } catch (_) {
      // молча — попробуем на следующем тике
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _data?['status'] ?? 'NEW';
    final currentStep = _steps.indexOf(status);

    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.white,
        title: Text(
          'Заказ №${widget.order.number}',
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                Icon(
                  status == 'CANCELLED'
                      ? Icons.cancel_outlined
                      : status == 'DELIVERED'
                      ? Icons.check_circle_outline
                      : Icons.local_pizza_outlined,
                  size: 56,
                  color: status == 'CANCELLED'
                      ? Colors.red
                      : const Color(0xFFE53935),
                ),
                const SizedBox(height: 12),
                Text(
                  _statusLabels[status] ?? status,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Сумма: ${formatTenge(widget.order.total)}',
                  style: const TextStyle(color: Colors.black54),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          if (status != 'CANCELLED')
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  for (var i = 0; i < _steps.length; i++)
                    _StepRow(
                      label: _statusLabels[_steps[i]]!,
                      done: currentStep >= i,
                      isLast: i == _steps.length - 1,
                    ),
                ],
              ),
            ),
          if (_canCancel) ...[
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: _cancelling ? null : _cancel,
              icon: const Icon(Icons.close),
              label: Text(
                _cancelling
                    ? 'Отменяем…'
                    : 'Отменить заказ · осталось $_minutesLeft мин',
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ],
          const SizedBox(height: 20),
          Center(
            child: TextButton(
              onPressed: () => Navigator.popUntil(context, (r) => r.isFirst),
              child: const Text('Вернуться в меню'),
            ),
          ),
        ],
      ),
    );
  }
}

class _CancelChoice {
  final String? reasonId;
  final String? comment;
  const _CancelChoice({this.reasonId, this.comment});
}

/// Выбор причины отмены.
///
/// Причина берётся из справочника, а не пишется текстом: свободный текст
/// невозможно сгруппировать в отчёт по отменам. Комментарий остаётся
/// дополнением к выбранной причине.
class _CancelDialog extends StatefulWidget {
  const _CancelDialog();

  @override
  State<_CancelDialog> createState() => _CancelDialogState();
}

class _CancelDialogState extends State<_CancelDialog> {
  List<CancelReason>? _reasons;
  String? _selected;
  String? _error;
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
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
    final reasons = _reasons;
    return AlertDialog(
      title: const Text('Отмена заказа'),
      content: SizedBox(
        width: 400,
        child: _error != null
            ? Text(_error!)
            : reasons == null
                ? const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Почему отменяете?'),
                      const SizedBox(height: 8),
                      Flexible(
                        child: SingleChildScrollView(
                          child: RadioGroup<String>(
                            groupValue: _selected,
                            onChanged: (v) => setState(() => _selected = v),
                            child: Column(
                              children: [
                                for (final r in reasons)
                                  RadioListTile<String>(
                                    value: r.id,
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(r.label),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      TextField(
                        controller: _comment,
                        maxLength: 300,
                        decoration: const InputDecoration(
                          labelText: 'Комментарий (необязательно)',
                        ),
                      ),
                    ],
                  ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Не отменять'),
        ),
        FilledButton(
          // Без выбранной причины отмена не уходит: иначе отчёт по отменам
          // снова превращается в кучу пустых строк.
          onPressed: _selected == null
              ? null
              : () => Navigator.pop(
                    context,
                    _CancelChoice(
                      reasonId: _selected,
                      comment: _comment.text.trim(),
                    ),
                  ),
          child: const Text('Отменить заказ'),
        ),
      ],
    );
  }
}

class _StepRow extends StatelessWidget {
  final String label;
  final bool done;
  final bool isLast;

  const _StepRow({
    required this.label,
    required this.done,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: done ? const Color(0xFF2E7D32) : const Color(0xFFE0E0E0),
                shape: BoxShape.circle,
              ),
              child: done
                  ? const Icon(Icons.check, size: 14, color: Colors.white)
                  : null,
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 28,
                color: done ? const Color(0xFF2E7D32) : const Color(0xFFE0E0E0),
              ),
          ],
        ),
        const SizedBox(width: 12),
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: done ? FontWeight.w600 : FontWeight.w400,
              color: done ? Colors.black : Colors.black45,
            ),
          ),
        ),
      ],
    );
  }
}
