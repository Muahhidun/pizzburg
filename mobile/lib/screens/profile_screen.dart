import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/push_notifications.dart';
import '../state/auth.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final push = context.watch<PushNotificationsService>();
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Профиль',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        backgroundColor: Colors.white,
      ),
      body: RefreshIndicator(
        onRefresh: auth.refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    auth.name.isEmpty ? 'Клиент PizzBurg' : auth.name,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    auth.phone,
                    style: const TextStyle(color: Colors.white60),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    '${auth.pointsBalance} баллов',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    'Кэшбэк ${auth.cashbackPct}% после выполнения заказа',
                    style: const TextStyle(color: Colors.white60),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            _NotificationsCard(push: push),
            const SizedBox(height: 18),
            const Text(
              'История баллов',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (auth.transactions.isEmpty)
              const Text(
                'Операций ещё не было',
                style: TextStyle(color: Colors.black45),
              ),
            ...auth.transactions.map((raw) {
              final txn = raw as Map<String, dynamic>;
              final amount = (txn['amount'] as num).toInt();
              return Container(
                margin: const EdgeInsets.only(bottom: 7),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            txn['comment'] ?? '',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          Text(
                            _date(txn['createdAt']),
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.black45,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${amount > 0 ? '+' : ''}$amount',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: amount > 0
                            ? const Color(0xFF2E7D32)
                            : Colors.red,
                      ),
                    ),
                  ],
                ),
              );
            }),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: auth.logout,
              child: const Text('Выйти из профиля'),
            ),
          ],
        ),
      ),
    );
  }

  static String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }
}

class _NotificationsCard extends StatelessWidget {
  final PushNotificationsService push;

  const _NotificationsCard({required this.push});

  @override
  Widget build(BuildContext context) {
    final enabled = push.status == PushNotificationsStatus.enabled;
    final busy =
        push.status == PushNotificationsStatus.checking ||
        push.status == PushNotificationsStatus.requesting;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                enabled
                    ? Icons.notifications_active_outlined
                    : Icons.notifications_none_outlined,
                color: enabled ? const Color(0xFF2E7D32) : Colors.black87,
              ),
              const SizedBox(width: 8),
              const Text(
                'Уведомления о заказе',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            _description(push),
            style: TextStyle(
              color: enabled ? const Color(0xFF2E7D32) : Colors.black54,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: enabled || busy
                  ? null
                  : () async {
                      final ok = await context
                          .read<PushNotificationsService>()
                          .requestPermission();
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            ok
                                ? 'Уведомления включены'
                                : _description(
                                    context.read<PushNotificationsService>(),
                                  ),
                          ),
                        ),
                      );
                    },
              child: Text(
                enabled
                    ? 'Уведомления включены'
                    : busy
                    ? 'Проверяем…'
                    : 'Включить уведомления',
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _description(PushNotificationsService push) {
    return switch (push.status) {
      PushNotificationsStatus.checking =>
        'Проверяем, поддерживает ли браузер уведомления…',
      PushNotificationsStatus.notRequested =>
        'Нажмите кнопку и разрешите уведомления в окне Safari.',
      PushNotificationsStatus.requesting =>
        'Ожидаем вашего ответа в системном окне Safari…',
      PushNotificationsStatus.enabled =>
        'Вы будете получать изменения статуса текущего заказа.',
      PushNotificationsStatus.denied =>
        'Safari запретил уведомления. Разрешите их в Safari → Настройки → Сайты → Уведомления и повторите.',
      PushNotificationsStatus.unavailable =>
        'Уведомления недоступны в этом браузере или Firebase не настроен.',
      PushNotificationsStatus.error =>
        'Не удалось включить уведомления${push.lastError == null ? '.' : ': ${push.lastError}'}',
    };
  }
}
