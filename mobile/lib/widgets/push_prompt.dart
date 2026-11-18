import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../i18n/strings.dart';
import '../services/push_notifications.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import 'motion.dart';

/// Пояснение перед системным запросом уведомлений.
///
/// Системное окно iOS показывается один раз: отказал — дальше только
/// через настройки телефона. Голое «PizzBurg хочет отправлять
/// уведомления» на старте выглядит как реклама, и люди отказывают.
/// Поэтому сначала говорим своими словами, что именно они потеряют, и
/// системное окно открываем, только когда человек сам нажал «Включить».
/// «Не сейчас» системный запрос не тратит — спросим снова после заказа.
class PushPrompt {
  static const _introKey = 'push_intro_shown';

  /// Первый запуск: один раз, если ещё не спрашивали
  static Future<void> maybeShowIntro(BuildContext context) async {
    final push = context.read<PushNotificationsService>();
    await push.initialize();
    if (push.status != PushNotificationsStatus.notRequested) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_introKey) == true) return;
    await prefs.setBool(_introKey, true);
    if (!context.mounted) return;
    await _show(context, push);
  }

  /// На экране живого заказа — тот самый момент, когда уведомления
  /// нужны. По каждому заказу не больше одного раза: «Не сейчас» не
  /// должно возвращаться при каждом открытии экрана.
  static Future<void> forOrder(BuildContext context, String orderId) async {
    final push = context.read<PushNotificationsService>();
    await push.initialize();
    if (push.status != PushNotificationsStatus.notRequested) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_orderKey) == orderId) return;
    await prefs.setString(_orderKey, orderId);
    // Первый запуск и этот экран не спрашивают дважды подряд
    await prefs.setBool(_introKey, true);
    if (!context.mounted) return;
    await _show(context, push);
  }

  static const _orderKey = 'push_prompt_order';

  static Future<void> _show(
    BuildContext context,
    PushNotificationsService push,
  ) async {
    final enable = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _IntroSheet(),
    );
    if (enable == true) await push.requestPermission();
  }
}

class _IntroSheet extends StatelessWidget {
  const _IntroSheet();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    Widget point(IconData icon, String text) => Padding(
      padding: const EdgeInsets.only(bottom: Gap.md),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: c.accentSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: c.accent),
          ),
          const SizedBox(width: Gap.md),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 14.5,
                height: 1.35,
                color: c.onSurface,
              ),
            ),
          ),
        ],
      ),
    );

    return Container(
      padding: EdgeInsets.fromLTRB(
        Gap.screen,
        Gap.blockWide,
        Gap.screen,
        Gap.lg + MediaQuery.of(context).padding.bottom,
      ),
      decoration: BoxDecoration(color: c.page, borderRadius: R.sheetTop),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            S.pushIntroTitle,
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: Gap.sm),
          Text(
            S.pushIntroLead,
            style: TextStyle(fontSize: 14, height: 1.4, color: c.muted),
          ),
          const SizedBox(height: Gap.lg),
          point(Icons.delivery_dining_rounded, S.pushIntroStatus),
          point(Icons.chat_bubble_outline_rounded, S.pushIntroReplies),
          point(Icons.account_balance_wallet_outlined, S.pushIntroMoney),
          Text(
            S.pushIntroNoSpam,
            style: TextStyle(fontSize: 12.5, color: c.muted),
          ),
          const SizedBox(height: Gap.lg),
          PressScale(
            onTap: () {
              Haptics.tap();
              Navigator.pop(context, true);
            },
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
              child: Text(
                S.turnOn,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: c.surface,
                ),
              ),
            ),
          ),
          const SizedBox(height: Gap.sm),
          PressScale(
            onTap: () => Navigator.pop(context, false),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              alignment: Alignment.center,
              child: Text(
                S.notNow,
                style: TextStyle(fontSize: 14, color: c.muted),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Полоса на экране живого заказа, когда уведомления запрещены.
///
/// Именно здесь человек ждёт «готово» и ответ кассира — и именно здесь
/// честно сказать, что ни того, ни другого не придёт, и дать кнопку,
/// которая ведёт прямо в настройки телефона.
class PushOffBanner extends StatelessWidget {
  const PushOffBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final push = context.watch<PushNotificationsService>();
    if (push.status != PushNotificationsStatus.denied) {
      return const SizedBox.shrink();
    }
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.only(top: Gap.lg),
      padding: const EdgeInsets.all(20),
      // Экран заказа всегда тёмный (фон panel, текст surface) — та же
      // подложка, что у карточки состава, и кнопка в цвет «выгоды».
      decoration: BoxDecoration(
        color: c.surface.withValues(alpha: 0.1),
        borderRadius: R.thumb,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            S.pushOffOrderTitle,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: c.surface,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            S.pushOffOrderHint,
            style: TextStyle(
              fontSize: 13,
              height: 1.4,
              color: c.surface.withValues(alpha: 0.75),
            ),
          ),
          const SizedBox(height: Gap.md),
          PressScale(
            onTap: () {
              Haptics.tap();
              push.openSystemSettings();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(color: c.benefit, borderRadius: R.pill),
              child: Text(
                S.openSettings,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: c.onBenefit,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
