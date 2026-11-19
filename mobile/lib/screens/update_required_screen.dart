import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../i18n/strings.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../widgets/motion.dart';

/// «Обновите приложение» — когда эта версия ниже минимальной.
///
/// Закрыть экран нельзя: заказ из устаревшей версии может уйти с
/// неверной оплатой или не дойти до кухни. Единственное действие —
/// перейти в стор.
class UpdateRequiredScreen extends StatelessWidget {
  final String storeUrl;
  const UpdateRequiredScreen({super.key, required this.storeUrl});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Material(
      color: c.panel,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Gap.screen),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: c.accent,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.system_update_rounded,
                  color: c.surface,
                  size: 30,
                ),
              ),
              const SizedBox(height: Gap.blockWide),
              Text(
                S.updateTitle,
                style: Theme.of(
                  context,
                ).textTheme.displayMedium?.copyWith(color: c.surface),
              ),
              const SizedBox(height: Gap.md),
              Text(
                S.updateBody,
                style: TextStyle(
                  fontSize: 15,
                  height: 1.45,
                  color: c.surface.withValues(alpha: 0.75),
                ),
              ),
              const Spacer(),
              PressScale(
                onTap: () => launchUrl(
                  Uri.parse(storeUrl),
                  mode: LaunchMode.externalApplication,
                ),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 17),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    S.updateButton,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: c.panel,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
