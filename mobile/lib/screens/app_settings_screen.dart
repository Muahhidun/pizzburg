import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/push_notifications.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';

/// Настройки приложения.
///
/// Вынесены с экрана профиля отдельно, и вот почему: профиль — про то,
/// ради чего человек возвращается (баллы, уровень, история), а тема,
/// уведомления и вибрация настраиваются один раз и больше не трогаются.
/// Три карточки постоянных настроек вытесняли вниз то, за чем сюда
/// заходят каждый раз.
class AppSettingsScreen extends StatelessWidget {
  const AppSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final push = context.read<PushNotificationsService>();

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            Gap.screen,
            Gap.lg,
            Gap.screen,
            Gap.blockWide,
          ),
          children: [
            Row(
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: Gap.md),
                  child: PressScale(
                    onTap: () => Navigator.pop(context),
                    child: Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: c.fillSoft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.arrow_back, size: 18, color: c.ink),
                    ),
                  ),
                ),
                Text(
                  'Настройки',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ],
            ),
            const SizedBox(height: Gap.block),

            _PushRow(push: push),
            const SizedBox(height: Gap.block),
            _NotificationsCard(push: push),
          ],
        ),
      ),
    );
  }
}

class _NotificationsCard extends StatelessWidget {
  final PushNotificationsService push;
  const _NotificationsCard({required this.push});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Вибрация',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  'Отклик при выборе и подтверждении',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ],
            ),
          ),
          _HapticsSwitch(),
        ],
      ),
    );
  }
}

/// Уведомления о заказе.
///
/// Строка нужна тем, кто отказался в диалоге после первого заказа: iOS
/// показывает это окно один раз, и без такой строки включить уведомления
/// обратно можно было бы только угадав путь в настройках телефона.

class _PushRow extends StatelessWidget {
  final PushNotificationsService push;
  const _PushRow({required this.push});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final status = context.watch<PushNotificationsService>().status;
    if (status == PushNotificationsStatus.unavailable) {
      return const SizedBox.shrink();
    }

    final (title, hint) = switch (status) {
      PushNotificationsStatus.enabled when push.isProvisional => (
        'Уведомления приходят тихо',
        'Без баннера и звука. Включить их: Настройки телефона → PizzBurg',
      ),
      PushNotificationsStatus.enabled => (
        'Уведомления включены',
        'Сообщим, когда заказ будет готов',
      ),
      PushNotificationsStatus.denied => (
        'Уведомления выключены',
        'Включить можно в Настройках телефона → PizzBurg → Уведомления',
      ),
      PushNotificationsStatus.requesting => ('Спрашиваем…', 'Секунду'),
      _ => ('Уведомления о заказе', 'Сообщим, когда заказ будет готов'),
    };

    final canAsk =
        status == PushNotificationsStatus.notRequested ||
        status == PushNotificationsStatus.error;

    return Container(
      margin: const EdgeInsets.only(bottom: Gap.block),
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(hint, style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
          ),
          if (canAsk)
            PressScale(
              onTap: () async {
                Haptics.tap();
                await push.requestPermission();
              },
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: c.accent,
                  borderRadius: R.pill,
                ),
                child: Text(
                  'Включить',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: c.surface,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _HapticsSwitch extends StatefulWidget {
  @override
  State<_HapticsSwitch> createState() => _HapticsSwitchState();
}

class _HapticsSwitchState extends State<_HapticsSwitch> {
  @override
  Widget build(BuildContext context) {
    return Switch(
      value: Haptics.enabled,
      activeThumbColor: context.colors.accent,
      onChanged: (v) async {
        await Haptics.setEnabled(v);
        if (v) Haptics.selection();
        if (mounted) setState(() {});
      },
    );
  }
}
