import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../i18n/strings.dart';
import '../services/app_config.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import 'motion.dart';

/// Сайт зовёт в приложение.
///
/// Сайт — тоже канал продаж, поэтому заказывать на нём не мешаем. Но
/// связь с клиентом (уведомления о заказе, ответы на сообщения, акции)
/// есть только в приложении, и баннеры объясняют именно это, а не просто
/// «установите приложение».
///
/// Чтобы не отпугнуть: окно показываем один раз и снова — не раньше чем
/// через [_popupPause]; полоску внизу человек закрывает на [_barPause].
/// QR под корзиной на компьютере стоит всегда и никому не мешает.
/// Каждый баннер выключается в админке (Лояльность → Баннеры сайта).
abstract final class AppPromo {
  static const _popupKey = 'app_promo_popup_closed_at';
  static const _barKey = 'app_promo_bar_closed_at';
  static const _popupPause = Duration(days: 14);
  static const _barPause = Duration(days: 7);

  static Future<bool> _paused(String key, Duration pause) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final at = prefs.getInt(key);
      if (at == null) return false;
      final closed = DateTime.fromMillisecondsSinceEpoch(at);
      return DateTime.now().difference(closed) < pause;
    } catch (_) {
      // Хранилище браузера недоступно (приватный режим) — не показываем,
      // иначе окно выскакивало бы при каждом заходе
      return true;
    }
  }

  static Future<void> _remember(String key) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(key, DateTime.now().millisecondsSinceEpoch);
    } catch (_) {}
  }

  static bool _popupShown = false;

  /// Окно при заходе на сайт. Только в браузере, раз в [_popupPause].
  static Future<void> maybeShowPopup(BuildContext context) async {
    if (!kIsWeb || _popupShown) return;
    final config = context.read<AppConfig>();
    if (!config.webPromo.popup) return;
    if (await _paused(_popupKey, _popupPause)) return;
    if (!context.mounted) return;
    _popupShown = true;
    // Отметку ставим сразу: закрыл окно, ушёл по ссылке или просто
    // перезагрузил страницу — повторять в ту же минуту нельзя
    await _remember(_popupKey);
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      barrierColor: Colors.black54,
      builder: (_) => const _PromoDialog(),
    );
  }

  static Future<void> openStore() => launchUrl(
    Uri.parse(ApiClient.appLink),
    mode: LaunchMode.externalApplication,
  );
}

/// Даты подарка коротко: «до 31.12» / «до 31.01»
String _day(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}';

/// Чем приложение лучше сайта — одним списком для окна и для QR
class _Benefits extends StatelessWidget {
  const _Benefits();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final gift = context.watch<AppConfig>().welcomeBonus;
    Widget row(IconData icon, String title, [String? hint]) => Padding(
      padding: EdgeInsets.only(bottom: Gap.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: c.accentSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: c.accent),
          ),
          const SizedBox(width: Gap.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: c.ink,
                    height: 1.3,
                  ),
                ),
                if (hint != null)
                  Text(hint, style: TextStyle(fontSize: 12.5, color: c.muted)),
              ],
            ),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (gift != null)
          row(
            Icons.card_giftcard_rounded,
            S.promoWelcome(gift.amount),
            S.promoGiftDates(
              gift.until == null ? null : _day(gift.until!),
              gift.spendUntil == null ? null : _day(gift.spendUntil!),
            ),
          ),
        row(Icons.notifications_active_outlined, S.promoStatus),
        row(Icons.chat_bubble_outline_rounded, S.promoChat),
        row(Icons.local_offer_outlined, S.promoOffers),
      ],
    );
  }
}

class _Qr extends StatelessWidget {
  final double size;
  const _Qr({required this.size});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Gap.sm),
      decoration: BoxDecoration(
        // QR всегда на белом: тёмная тема не должна мешать камере
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: c.line),
      ),
      child: QrImageView(
        data: ApiClient.appLink,
        size: size,
        padding: EdgeInsets.zero,
        backgroundColor: Colors.white,
        eyeStyle: const QrEyeStyle(
          eyeShape: QrEyeShape.square,
          color: Color(0xFF0B0B14),
        ),
        dataModuleStyle: const QrDataModuleStyle(
          dataModuleShape: QrDataModuleShape.square,
          color: Color(0xFF0B0B14),
        ),
      ),
    );
  }
}

class _PromoDialog extends StatelessWidget {
  const _PromoDialog();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final wide = WideLayout.of(context);
    final gift = context.watch<AppConfig>().welcomeBonus;
    return Dialog(
      backgroundColor: c.page,
      insetPadding: const EdgeInsets.all(Gap.screen),
      shape: const RoundedRectangleBorder(borderRadius: R.block),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            Gap.blockWide,
            Gap.md,
            Gap.md,
            Gap.blockWide,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  tooltip: S.close,
                  onPressed: () => Navigator.pop(context),
                  icon: Icon(Icons.close_rounded, color: c.muted),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: Gap.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      gift != null
                          ? S.promoTitleGift(gift.amount)
                          : S.promoTitle,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: Gap.sm),
                    Text(
                      S.promoLead,
                      style: TextStyle(
                        fontSize: 14,
                        color: c.muted,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: Gap.block),
                    const _Benefits(),
                    const SizedBox(height: Gap.md),
                    if (wide)
                      Row(
                        children: [
                          const _Qr(size: 132),
                          const SizedBox(width: Gap.lg),
                          Expanded(
                            child: Text(
                              S.promoScan,
                              style: TextStyle(
                                fontSize: 13.5,
                                color: c.ink,
                                height: 1.4,
                              ),
                            ),
                          ),
                        ],
                      )
                    else
                      PressScale(
                        onTap: () {
                          Navigator.pop(context);
                          AppPromo.openStore();
                        },
                        child: Container(
                          width: double.infinity,
                          height: 52,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: c.accent,
                            borderRadius: R.pill,
                          ),
                          child: Text(
                            S.promoDownload,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: c.surface,
                            ),
                          ),
                        ),
                      ),
                    const SizedBox(height: Gap.sm),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: Text(
                          S.promoStay,
                          style: TextStyle(color: c.muted, fontSize: 13.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Узкая полоска над нижним меню на телефоне. Закрыли — пропадает на
/// неделю; не закрыли — не мешает: меню под ней листается как обычно.
class AppPromoBar extends StatefulWidget {
  const AppPromoBar({super.key});

  @override
  State<AppPromoBar> createState() => _AppPromoBarState();
}

class _AppPromoBarState extends State<AppPromoBar> {
  bool _visible = false;
  bool _popupSeen = false;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) _check();
  }

  /// Первый заход — только окно, полоска не дублирует его. Полоска
  /// появляется со следующих заходов, пока окно «отдыхает». Решение о
  /// том, включено ли окно, — в build: настройки сайта приходят позже.
  Future<void> _check() async {
    final paused = await AppPromo._paused(AppPromo._barKey, AppPromo._barPause);
    final popupSeen = await AppPromo._paused(
      AppPromo._popupKey,
      AppPromo._popupPause,
    );
    if (!mounted || paused) return;
    setState(() {
      _visible = true;
      _popupSeen = popupSeen;
    });
  }

  void _close() {
    setState(() => _visible = false);
    AppPromo._remember(AppPromo._barKey);
  }

  @override
  Widget build(BuildContext context) {
    final config = context.watch<AppConfig>();
    final promo = config.webPromo;
    // В заход, когда показали окно, полоска его не повторяет
    if (!kIsWeb ||
        !_visible ||
        !promo.bar ||
        AppPromo._popupShown ||
        (promo.popup && !_popupSeen)) {
      return const SizedBox.shrink();
    }
    final c = context.colors;
    final gift = config.welcomeBonus;
    return Material(
      color: c.panel,
      borderRadius: R.pill,
      elevation: 6,
      shadowColor: Colors.black38,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 6, 4, 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                gift != null ? S.promoBarGift(gift.amount) : S.promoBar,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: c.surface,
                  height: 1.25,
                ),
              ),
            ),
            const SizedBox(width: Gap.sm),
            PressScale(
              onTap: AppPromo.openStore,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: c.benefit,
                  borderRadius: R.pill,
                ),
                child: Text(
                  S.promoBarAction,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: c.onBenefit,
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: S.close,
              onPressed: _close,
              visualDensity: VisualDensity.compact,
              icon: Icon(Icons.close_rounded, size: 18, color: c.surface),
            ),
          ],
        ),
      ),
    );
  }
}

/// QR на приложение под корзиной на компьютере. Не закрывается: он
/// никому не мешает и всегда под рукой. Оформлен как наши баннеры —
/// кобальт, лаймовая плашка выгоды и телефон с экраном приложения, —
/// чтобы бросался в глаза, а не сливался с корзиной.
class DesktopAppQr extends StatelessWidget {
  const DesktopAppQr({super.key});

  @override
  Widget build(BuildContext context) {
    final config = context.watch<AppConfig>();
    if (!kIsWeb || !config.webPromo.qr) return const SizedBox.shrink();
    final c = context.colors;
    final gift = config.welcomeBonus;
    const blue = Color(0xFF2B3BEE);
    const lime = Color(0xFFD6F84C);
    const ink = Color(0xFF0B0B14);
    final dates = gift == null
        ? null
        : S.promoGiftDates(
            gift.until == null ? null : _day(gift.until!),
            gift.spendUntil == null ? null : _day(gift.spendUntil!),
          );
    final hint = TextStyle(
      fontSize: 11.5,
      color: Colors.white.withValues(alpha: 0.85),
      height: 1.35,
    );
    return Container(
      margin: const EdgeInsets.only(top: Gap.md),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: blue,
        borderRadius: R.block,
        border: Border.all(color: c.border),
      ),
      child: Stack(
        children: [
          // Телефон выглядывает справа снизу, чуть наклонён
          Positioned(
            right: -22,
            bottom: -64,
            child: Transform.rotate(
              angle: 0.14,
              child: Container(
                width: 104,
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: ink,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: const [
                    BoxShadow(
                      color: Colors.black38,
                      blurRadius: 18,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.asset(
                    'assets/branding/promo-screen.jpg',
                    fit: BoxFit.cover,
                  ),
                ),
              ),
            ),
          ),
          Padding(
            // Справа место под телефон
            padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.lg, 92, Gap.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (gift != null) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: lime,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      S.promoWelcome(gift.amount),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                Text(
                  S.promoQrTitle,
                  maxLines: 1,
                  style: const TextStyle(
                    fontFamily: 'Unbounded',
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: Gap.md),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(5),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: QrImageView(
                        data: ApiClient.appLink,
                        size: 78,
                        padding: EdgeInsets.zero,
                        backgroundColor: Colors.white,
                        eyeStyle: const QrEyeStyle(
                          eyeShape: QrEyeShape.square,
                          color: ink,
                        ),
                        dataModuleStyle: const QrDataModuleStyle(
                          dataModuleShape: QrDataModuleShape.square,
                          color: ink,
                        ),
                      ),
                    ),
                    const SizedBox(width: Gap.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(S.promoQrHint, style: hint),
                          if (dates != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              dates,
                              style: hint.copyWith(
                                color: lime,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Карточка в профиле на сайте: подарок здесь не начисляется, и человек
/// должен понять почему и где его взять.
class WebGiftCard extends StatelessWidget {
  const WebGiftCard({super.key});

  @override
  Widget build(BuildContext context) {
    final gift = context.watch<AppConfig>().welcomeBonus;
    if (!kIsWeb || gift == null) return const SizedBox.shrink();
    final c = context.colors;
    final wide = WideLayout.of(context);
    final dates = S.promoGiftDates(
      gift.until == null ? null : _day(gift.until!),
      gift.spendUntil == null ? null : _day(gift.spendUntil!),
    );
    return Container(
      margin: const EdgeInsets.only(top: Gap.md),
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.benefit, borderRadius: R.thumb),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  S.promoProfileGift(gift.amount),
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: c.onBenefit,
                  ),
                ),
                if (dates != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    dates,
                    style: TextStyle(fontSize: 12.5, color: c.onBenefit),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: Gap.md),
          if (wide)
            const _Qr(size: 72)
          else
            PressScale(
              onTap: AppPromo.openStore,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                decoration: BoxDecoration(color: c.panel, borderRadius: R.pill),
                child: Text(
                  S.promoBarAction,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
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
