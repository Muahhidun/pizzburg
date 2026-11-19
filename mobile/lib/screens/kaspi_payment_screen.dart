import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../i18n/strings.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'app_shell.dart';
import 'order_screen.dart';
import '../widgets/app_route.dart';

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

/// Сайт открыт на компьютере: ссылку Kaspi открыть нечем, платим по QR.
/// В браузере телефона `defaultTargetPlatform` — iOS или Android.
bool get kaspiByQr =>
    kIsWeb &&
    defaultTargetPlatform != TargetPlatform.iOS &&
    defaultTargetPlatform != TargetPlatform.android;

class _KaspiPaymentScreenState extends State<KaspiPaymentScreen>
    with WidgetsBindingObserver {
  KaspiPayment? _payment;
  Timer? _poller;
  bool _busy = true;
  bool _opening = false;
  bool _autoOpened = false;
  String? _localError;

  /// Обратный отсчёт до перехода к заказу после оплаты.
  ///
  /// Идёт, только пока экран на виду: человек может ещё быть в Kaspi, и
  /// переход «за кадром» он бы не увидел — вернулся бы уже не туда,
  /// откуда ушёл. Свернули приложение — отсчёт сбрасывается.
  static const _countdownFrom = 3;
  int? _countdown;
  Timer? _countdownTimer;

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
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _sync();
      _maybeStartCountdown();
    } else {
      _stopCountdown();
    }
  }

  bool get _onScreen =>
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  void _maybeStartCountdown() {
    if (!(_payment?.isProcessed ?? false) || !_onScreen) return;
    if (_countdownTimer?.isActive ?? false) return;
    setState(() => _countdown = _countdownFrom);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || !_onScreen) return _stopCountdown();
      final left = (_countdown ?? _countdownFrom) - 1;
      if (left <= 0) {
        timer.cancel();
        _openOrder();
        return;
      }
      setState(() => _countdown = left);
    });
  }

  void _stopCountdown() {
    _countdownTimer?.cancel();
    _countdownTimer = null;
    if (mounted && _countdown != null) setState(() => _countdown = null);
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
        qr: kaspiByQr,
      );
      if (!mounted) return;
      setState(() {
        _payment = payment;
        _busy = false;
      });
      _startPolling(payment.pollingIntervalSeconds);
      if (payment.isProcessed) _maybeStartCountdown();
      // Экран обещает «Открываем Kaspi.kz» — открываем сами, без второго
      // нажатия. Кнопка остаётся на случай, если человек вернулся назад.
      //
      // В браузере не открываем сами: окно без нажатия человека браузер
      // блокирует как всплывающее. Там ждём нажатия на кнопку Kaspi.
      if (!kIsWeb &&
          !_autoOpened &&
          payment.paymentLink != null &&
          !payment.isProcessed) {
        _autoOpened = true;
        await _openKaspi();
      }
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
      if (synced.isProcessed) {
        Haptics.success();
        _maybeStartCountdown();
      }
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
      // Ссылки нет — Kaspi не создал её в прошлый раз. Пробуем заново, а не
      // показываем ту же ошибку: иначе кнопка ничего не делает.
      await _create();
      final again = _payment?.paymentLink;
      if (again != null && mounted) await _openKaspi();
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

  bool _leaving = false;

  Future<void> _openOrder() async {
    if (_leaving) return;
    _leaving = true;
    _stopCountdown();
    final auth = context.read<AuthState>();
    if (auth.isAuthenticated) await auth.refresh();
    if (!mounted) return;
    AppShell.showMenu();
    Navigator.pushAndRemoveUntil(
      context,
      AppRoute(builder: (_) => OrderScreen(order: widget.order)),
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final payment = _payment;
    final success = payment?.isProcessed ?? false;
    final failed = payment?.isError ?? false;
    // Что положить в QR: код Kaspi, а если его нет — платёжную ссылку
    // (её тоже понимает камера телефона)
    final qrData = payment?.qrToken ?? payment?.paymentLink;
    final showQr = kaspiByQr && !success && !failed && qrData != null;

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
        : showQr
        ? S.kaspiScanTitle
        : S.kaspiPaymentTitle;
    final hint = success
        ? S.kaspiSuccessHint
        : failed
        ? S.kaspiFailedHint
        : payment?.status == 'WAIT'
        ? S.kaspiWaitingHint
        : showQr
        ? S.kaspiScanHint
        : kIsWeb
        ? S.kaspiPayHint
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
              if (showQr)
                Container(
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    // QR всегда на белом: тёмная тема не должна мешать
                    // камере Kaspi
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: c.line),
                  ),
                  child: QrImageView(
                    data: qrData,
                    size: 232,
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
                )
              else
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
                _ActionButton(
                  label: _countdown == null
                      ? S.openOrder
                      : S.openOrderIn(_countdown!),
                  onTap: _openOrder,
                )
              else if (failed)
                _ActionButton(label: S.retry, onTap: _create)
              else if (showQr)
                // На компьютере кнопка Kaspi открыла бы пустую вкладку
                const SizedBox.shrink()
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
                    // Кнопка — официальный SVG из Figma Kaspi без правок.
                    // Фон под ней того же красного (#F14635), чтобы на
                    // широком экране она тянулась на всю ширину, не меняя
                    // ни цвета, ни содержимого. Высота 52 ≥ 48 dp по гайду.
                    child: Container(
                      width: double.infinity,
                      height: 52,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF14635),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      alignment: Alignment.center,
                      child: SvgPicture.asset(
                        'assets/kaspi/pay-button-red.svg',
                        height: 52,
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
