import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';

/// Экран статуса заказа. Пока опрашивает API; после подключения FCM
/// статус будет прилетать пушем.
class OrderScreen extends StatefulWidget {
  final CreatedOrder order;
  const OrderScreen({super.key, required this.order});

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  Map<String, dynamic>? _data;
  Timer? _timer;

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
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data =
          await context.read<ApiClient>().orderStatus(widget.order.id);
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
        title: Text('Заказ №${widget.order.number}',
            style: const TextStyle(fontWeight: FontWeight.w800)),
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
                      fontSize: 22, fontWeight: FontWeight.w800),
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

class _StepRow extends StatelessWidget {
  final String label;
  final bool done;
  final bool isLast;

  const _StepRow(
      {required this.label, required this.done, required this.isLast});

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
