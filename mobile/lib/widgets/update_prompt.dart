import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../i18n/strings.dart';
import '../services/app_config.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/motion.dart';

/// «Вышла новая версия» — мягкое напоминание обновиться (Дом, 28.11.2026).
///
/// Закрывать приложение ради обновления грубо: человек может просто уйти.
/// Поэтому окно снизу с «Обновить» и «Позже», и после показа молчит два
/// дня. Обязательное обновление (экран без выхода) остаётся только на
/// случай, когда старая версия сломалась.
///
/// Показываем только поверх главного экрана: не посреди оформления и не
/// поверх другого окна — тогда ждём следующего запуска или возврата.
abstract final class UpdatePrompt {
  static const _key = 'pizzburg_update_prompt_at';
  static const quiet = Duration(days: 2);
  static bool _showing = false;

  /// Пора ли показать: прошло [quiet] с прошлого показа
  @visibleForTesting
  static bool due(int? lastShownMs, DateTime now) =>
      lastShownMs == null ||
      now.difference(DateTime.fromMillisecondsSinceEpoch(lastShownMs)) >= quiet;

  static Future<void> maybeShow(BuildContext context, AppConfig config) async {
    final url = config.storeUrl;
    if (_showing || !config.updateSuggested || url == null) return;
    if (!(ModalRoute.of(context)?.isCurrent ?? false)) return;
    _showing = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!due(prefs.getInt(_key), DateTime.now()) || !context.mounted) return;
      await prefs.setInt(_key, DateTime.now().millisecondsSinceEpoch);
      if (!context.mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: context.colors.page,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (context) => _Sheet(storeUrl: url),
      );
    } catch (_) {
      // Нет хранилища — не беда, напомним в другой раз
    } finally {
      _showing = false;
    }
  }
}

class _Sheet extends StatelessWidget {
  final String storeUrl;
  const _Sheet({required this.storeUrl});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Gap.screen,
          Gap.blockWide,
          Gap.screen,
          Gap.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 52,
              height: 52,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: c.accentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.system_update_rounded,
                color: c.accent,
                size: 26,
              ),
            ),
            const SizedBox(height: Gap.lg),
            Text(
              S.updateAvailableTitle,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: Gap.sm),
            Text(
              S.updateAvailableBody,
              style: TextStyle(fontSize: 14.5, height: 1.45, color: c.muted),
            ),
            const SizedBox(height: Gap.blockWide),
            PressScale(
              onTap: () {
                Navigator.pop(context);
                launchUrl(
                  Uri.parse(storeUrl),
                  mode: LaunchMode.externalApplication,
                );
              },
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 16),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: c.accent,
                  borderRadius: R.pill,
                ),
                child: Text(
                  S.updateButton,
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
              onTap: () => Navigator.pop(context),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 14),
                alignment: Alignment.center,
                child: Text(
                  S.later,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: c.muted,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
