import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../utils/input_validation.dart';
import '../widgets/motion.dart';
import '../i18n/strings.dart';

/// Вход по телефону.
///
/// Механика OTP жила в `AuthState` с самого начала, но экрана к ней не
/// было: профиль звал «Войдите по телефону» и не давал ни одной кнопки.
/// Здесь ровно два шага — номер и код, — потому что третьего у входа по
/// смс не бывает, а лишний экран между ними теряет людей.
class LoginScreen extends StatefulWidget {
  /// Номер, который человек уже ввёл при оформлении заказа.
  ///
  /// Профиль открывает экран без него, а оформление передаёт заполненное
  /// значение, чтобы не просить одни и те же данные дважды.
  final String? initialPhone;

  const LoginScreen({super.key, this.initialPhone});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with WidgetsBindingObserver {
  late final TextEditingController _phone;
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  /// Куда ушёл код: `telegram` или `sms`. От этого зависит заголовок —
  /// человек должен знать, где искать код (DECISIONS §12.40).
  String _channel = 'sms';

  /// Секунд до кнопки «Отправить по смс» после Telegram-кода.
  int _smsIn = 0;
  Timer? _smsTimer;

  /// Код из буфера обмена — после того как человек скопировал его в
  /// Telegram и вернулся. Предлагаем вставить, но не вставляем сами.
  String? _clipboardCode;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _phone = TextEditingController(
      text: formatKzPhone(widget.initialPhone ?? ''),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _smsTimer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _checkClipboard();
  }

  /// Вернулись из Telegram — вдруг код уже в буфере.
  ///
  /// `hasStrings` не показывает системный запрос на вставку, поэтому сам
  /// буфер читаем, только если там что-то есть.
  Future<void> _checkClipboard() async {
    if (!_codeSent || _channel != 'telegram' || _code.text.isNotEmpty) return;
    if (!await Clipboard.hasStrings()) return;
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final match = RegExp(r'\b(\d{6})\b').firstMatch(data?.text ?? '');
    if (!mounted || match == null) return;
    setState(() => _clipboardCode = match.group(1));
  }

  /// Форматтер держит маску, серверу нужны только цифры.
  String get _digits => _phone.text.replaceAll(RegExp(r'\D'), '');

  Future<void> _send({String channel = 'auto'}) async {
    if (_digits.length < 11) {
      setState(() => _error = S.enterFullPhone);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await context.read<AuthState>().requestOtp(
        _digits,
        channel: channel,
      );
      Haptics.success();
      final viaTelegram = res['channel'] == 'telegram';
      _smsTimer?.cancel();
      setState(() {
        _codeSent = true;
        _busy = false;
        _channel = viaTelegram ? 'telegram' : 'sms';
        _clipboardCode = null;
        _smsIn = viaTelegram
            ? ((res['smsFallbackAfterMs'] as num?) ?? 25000) ~/ 1000
            : 0;
      });
      if (viaTelegram) {
        _smsTimer = Timer.periodic(const Duration(seconds: 1), (t) {
          if (!mounted || _smsIn <= 0) return t.cancel();
          setState(() => _smsIn--);
        });
      }
    } catch (e) {
      setState(() {
        _error = _message(e);
        _busy = false;
      });
    }
  }

  Future<void> _verify() async {
    if (_code.text.trim().length < 4) {
      setState(() => _error = S.enterSmsCode);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthState>().verifyOtp(_digits, _code.text.trim());
      Haptics.success();
      // true — «вход состоялся»: оформление ждёт этого ответа, чтобы
      // продолжить прерванный заказ, а не начинать его заново.
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      Haptics.warning();
      setState(() {
        _error = _message(e);
        _busy = false;
      });
    }
  }

  /// Сообщение сервера человеку полезнее, чем «ошибка 400», но техническую
  /// обёртку исключения показывать нельзя.
  String _message(Object e) {
    final text = e.toString().replaceFirst('Exception: ', '');
    return text.isEmpty || text.length > 120 ? S.tryAgainShort : text;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Scaffold(
      backgroundColor: c.page,
      appBar: AppBar(
        backgroundColor: c.page,
        elevation: 0,
        title: Text(S.signIn),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Gap.screen),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                !_codeSent
                    ? S.yourPhone
                    : (_channel == 'telegram'
                          ? S.telegramCodeTitle
                          : S.smsCodeTitle),
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: Gap.sm),
              Text(
                !_codeSent
                    ? S.smsInsteadOfPassword
                    : (_channel == 'telegram'
                          ? S.telegramSentTo(_phone.text)
                          : S.sentTo(_phone.text)),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: Gap.block),

              if (!_codeSent)
                _Field(
                  controller: _phone,
                  hint: '+7 (___) ___ __ __',
                  keyboard: TextInputType.phone,
                  formatters: [KzPhoneInputFormatter()],
                  autofocus: true,
                  onSubmit: _send,
                )
              else
                _Field(
                  controller: _code,
                  hint: S.codeHint,
                  keyboard: TextInputType.number,
                  formatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  autofocus: true,
                  onSubmit: _verify,
                  // iOS подсказывает код из смс над клавиатурой, Android
                  // предлагает его через автозаполнение
                  autofillHints: const [AutofillHints.oneTimeCode],
                ),

              if (_codeSent && _clipboardCode != null) ...[
                const SizedBox(height: Gap.sm),
                _LinkButton(
                  text: S.pasteCode(_clipboardCode!),
                  onTap: () {
                    _code.text = _clipboardCode!;
                    setState(() => _clipboardCode = null);
                    _verify();
                  },
                ),
              ],

              if (_error != null) ...[
                const SizedBox(height: Gap.md),
                Text(
                  _error!,
                  style: TextStyle(fontSize: 13, color: c.warnText),
                ),
              ],

              const SizedBox(height: Gap.block),
              PressScale(
                onTap: _busy ? null : (_codeSent ? _verify : _send),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _busy ? c.muted : c.accent,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    _busy
                        ? S.pleaseWait
                        : (_codeSent ? S.signInAction : S.getCode),
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: c.surface,
                    ),
                  ),
                ),
              ),

              if (_codeSent && _channel == 'telegram') ...[
                const SizedBox(height: Gap.md),
                _LinkButton(
                  text: _smsIn > 0 ? S.sendBySmsIn(_smsIn) : S.sendBySms,
                  enabled: !_busy && _smsIn <= 0,
                  onTap: () => _send(channel: 'sms'),
                ),
              ],

              if (_codeSent)
                _LinkButton(
                  text: S.changePhone,
                  enabled: !_busy,
                  onTap: () {
                    _smsTimer?.cancel();
                    setState(() {
                      _codeSent = false;
                      _code.clear();
                      _error = null;
                      _clipboardCode = null;
                    });
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Текстовая кнопка под основной: «Изменить номер», «Отправить по смс».
class _LinkButton extends StatelessWidget {
  final String text;
  final VoidCallback onTap;
  final bool enabled;

  const _LinkButton({
    required this.text,
    required this.onTap,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: enabled ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.sm),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: enabled ? c.accent : c.muted,
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final TextInputType keyboard;
  final List<TextInputFormatter> formatters;
  final bool autofocus;
  final VoidCallback onSubmit;
  final Iterable<String>? autofillHints;

  const _Field({
    required this.controller,
    required this.hint,
    required this.keyboard,
    required this.formatters,
    required this.autofocus,
    required this.onSubmit,
    this.autofillHints,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return TextField(
      controller: controller,
      keyboardType: keyboard,
      inputFormatters: formatters,
      autofocus: autofocus,
      autofillHints: autofillHints,
      onSubmitted: (_) => onSubmit(),
      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: c.fillSoft,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 18,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: R.field,
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
