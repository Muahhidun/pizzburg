import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../i18n/strings.dart';
import '../services/push_notifications.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'order_screen.dart';

/// Второй предохранитель после серверного `payments.kaspiOnline`.
///
/// Даже если способ оплаты случайно включат в админке, обычная store-сборка
/// не покажет его без явного флага и официального ассета Kaspi.
const kKaspiBrandAssetsReady = bool.fromEnvironment(
  'KASPI_BRAND_ASSETS_READY',
  defaultValue: false,
);

class KaspiPaymentScreen extends StatefulWidget {
  final CreatedOrder order;

  const KaspiPaymentScreen({super.key, required this.order});

  @override
  State<KaspiPaymentScreen> createState() => _KaspiPaymentScreenState();
}

class _KaspiPaymentScreenState extends State<KaspiPaymentScreen>
    with WidgetsBindingObserver {
  KaspiPayment? _payment;
  Timer? _poller;
  bool _busy = true;
  bool _opening = false;
  String? _localError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _create();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poller?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _sync();
  }

  Future<void> _create() async {
    _poller?.cancel();
    setState(() {
      _busy = true;
      _localError = null;
    });
    try {
      final payment = await context.read<ApiClient>().createKaspiPayment(
        widget.order.id,
      );
      if (!mounted) return;
      setState(() {
        _payment = payment;
        _busy = false;
      });
      _startPolling(payment.pollingIntervalSeconds);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = error.toString();
      });
    }
  }

  void _startPolling(int seconds) {
    _poller?.cancel();
    final interval = Duration(seconds: seconds.clamp(3, 30));
    _poller = Timer.periodic(interval, (_) => _sync());
  }

  Future<void> _sync() async {
    final payment = _payment;
    if (payment == null || payment.isProcessed || payment.isError) return;
    try {
      final synced = await context.read<ApiClient>().syncKaspiPayment(
        widget.order.id,
      );
      if (!mounted) return;
      setState(() => _payment = synced);
      if (synced.isProcessed || synced.isError) _poller?.cancel();
      if (synced.isProcessed) Haptics.success();
    } catch (error) {
      // Один сетевой сбой не превращает оплату в ошибку: следующий тик
      // попробует снова. Текст показываем, чтобы ожидание не выглядело
      // зависшим.
      if (mounted) setState(() => _localError = error.toString());
    }
  }

  Future<void> _openKaspi() async {
    final raw = _payment?.paymentLink;
    final uri = raw == null ? null : Uri.tryParse(raw);
    if (uri == null) {
      setState(() => _localError = S.kaspiFailedHint);
      return;
    }
    setState(() {
      _opening = true;
      _localError = null;
    });
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!mounted) return;
    setState(() {
      _opening = false;
      if (!opened) _localError = S.kaspiFailedHint;
    });
  }

  Future<void> _openOrder() async {
    unawaited(context.read<PushNotificationsService>().requestPermission());
    final auth = context.read<AuthState>();
    if (auth.isAuthenticated) await auth.refresh();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => OrderScreen(order: widget.order)),
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final payment = _payment;
    final success = payment?.isProcessed ?? false;
    final failed = payment?.isError ?? false;

    final icon = success
        ? Icons.check_rounded
        : failed
        ? Icons.close_rounded
        : Icons.account_balance_wallet_outlined;
    final title = success
        ? S.kaspiSuccess
        : failed
        ? S.kaspiFailed
        : payment?.status == 'WAIT'
        ? S.kaspiWaiting
        : S.kaspiPaymentTitle;
    final hint = success
        ? S.kaspiSuccessHint
        : failed
        ? S.kaspiFailedHint
        : payment?.status == 'WAIT'
        ? S.kaspiWaitingHint
        : S.kaspiOpening;

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Gap.screen,
            Gap.blockWide,
            Gap.screen,
            Gap.blockWide,
          ),
          child: Column(
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  S.orderNo(widget.order.number),
                  style: TextStyle(color: c.muted, fontWeight: FontWeight.w600),
                ),
              ),
              const Spacer(),
              AnimatedContainer(
                duration: Motion.base,
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: success
                      ? c.benefit
                      : failed
                      ? c.danger.withValues(alpha: 0.12)
                      : c.accentSoft,
                ),
                alignment: Alignment.center,
                child: _busy
                    ? CircularProgressIndicator(color: c.accent)
                    : Icon(
                        icon,
                        size: 42,
                        color: success
                            ? c.onBenefit
                            : failed
                            ? c.danger
                            : c.accent,
                      ),
              ),
              const SizedBox(height: Gap.block),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: Gap.md),
              Text(
                hint,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, height: 1.45, color: c.muted),
              ),
              const SizedBox(height: Gap.lg),
              Text(
                '${widget.order.total} ₸',
                style: Theme.of(context).textTheme.displayMedium,
              ),
              if (_localError != null) ...[
                const SizedBox(height: Gap.lg),
                Text(
                  _localError!,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: c.danger),
                ),
              ],
              const Spacer(),
              if (success)
                _ActionButton(label: S.openOrder, onTap: _openOrder)
              else if (failed)
                _ActionButton(label: S.retry, onTap: _create)
              else if (!kKaspiBrandAssetsReady)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    color: c.warnSoft,
                    borderRadius: R.field,
                  ),
                  child: Text(
                    S.kaspiOfficialAssetsMissing,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: c.warnText,
                    ),
                  ),
                )
              else
                PressScale(
                  onTap: _opening || _busy ? null : _openKaspi,
                  child: Semantics(
                    button: true,
                    label: S.kaspiOpen,
                    child: Container(
                      height: 56,
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: R.pill,
                      ),
                      child: Image.asset(
                        'assets/kaspi/pay-button-red.png',
                        fit: BoxFit.contain,
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

class _ActionButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _ActionButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) => PressScale(
    onTap: onTap,
    child: Container(
      width: double.infinity,
      height: 56,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: context.colors.accent,
        borderRadius: R.pill,
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 14.5,
          fontWeight: FontWeight.w600,
          color: context.colors.surface,
        ),
      ),
    ),
  );
}
