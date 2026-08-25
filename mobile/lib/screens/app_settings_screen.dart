import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/push_notifications.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import '../i18n/strings.dart';
import '../state/auth.dart';

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
                  S.settings,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ],
            ),
            const SizedBox(height: Gap.block),

            _PushRow(push: push),
            const SizedBox(height: Gap.block),
            _NotificationsCard(push: push),

            // Только для вошедших: гостю удалять нечего, а красная кнопка
            // без причины пугает.
            if (context.watch<AuthState>().isAuthenticated) ...[
              const SizedBox(height: Gap.blockWide),
              const _DeleteAccountRow(),
            ],
          ],
        ),
      ),
    );
  }
}

/// Удаление аккаунта.
///
/// Требование App Store: если аккаунт можно завести в приложении, его
/// должно быть можно оттуда же удалить, а не письмом в поддержку
/// (Guideline 5.1.1(v)). Внизу настроек и приглушённое до нажатия —
/// это выход, а не действие, которое предлагают.
class _DeleteAccountRow extends StatefulWidget {
  const _DeleteAccountRow();

  @override
  State<_DeleteAccountRow> createState() => _DeleteAccountRowState();
}

class _DeleteAccountRowState extends State<_DeleteAccountRow> {
  bool _busy = false;

  Future<void> _confirm() async {
    final c = context.colors;
    final agreed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: c.surface,
        shape: const RoundedRectangleBorder(borderRadius: R.field),
        title: Text(S.deleteAccountTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(S.deleteAccountWhatGoes, style: const TextStyle(height: 1.45)),
            const SizedBox(height: Gap.md),
            Text(
              S.deleteAccountWhatStays,
              style: TextStyle(fontSize: 13.5, height: 1.45, color: c.muted),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(S.cancel, style: TextStyle(color: c.ink)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(
              S.deleteAccountConfirm,
              style: TextStyle(color: c.danger, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
    if (agreed != true || !mounted) return;

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await context.read<AuthState>().deleteAccount();
      if (!mounted) return;
      navigator.pop();
      messenger.showSnackBar(SnackBar(content: Text(S.accountDeleted)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      // Показываем причину сервера: чаще всего это «дождитесь доставки».
      messenger.showSnackBar(
        SnackBar(content: Text(e is Exception ? _reason(e) : S.saveFailed)),
      );
    }
  }

  String _reason(Object e) {
    final text = e.toString().replaceFirst('Exception: ', '').trim();
    return text.isEmpty ? S.saveFailed : text;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: _busy ? null : _confirm,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 15),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: c.fillSoft,
          borderRadius: R.pill,
        ),
        child: Text(
          _busy ? S.deleting : S.deleteAccount,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: c.danger,
          ),
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
                Text(
                  S.vibration,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  S.vibrationHint,
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
        S.pushQuietTitle,
        S.pushQuietHint,
      ),
      PushNotificationsStatus.enabled => (
        S.pushOnTitle,
        S.pushOrderHint,
      ),
      PushNotificationsStatus.denied => (
        S.pushOffTitle,
        S.pushOffHint,
      ),
      PushNotificationsStatus.requesting => (S.asking, S.justASecond),
      _ => (S.orderNotifications, S.pushOrderHint),
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
                  S.turnOn,
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
