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
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  /// Код, который сервер вернул прямо в ответе. Так он поступает только с
  /// заранее названными тестовыми номерами и только пока не подключён
  /// SMS-шлюз: в обычном режиме поле пустое, и код приходит в смс.
  String? _devCode;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  /// Форматтер держит маску, серверу нужны только цифры.
  String get _digits => _phone.text.replaceAll(RegExp(r'\D'), '');

  Future<void> _send() async {
    if (_digits.length < 11) {
      setState(() => _error = S.enterFullPhone);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await context.read<AuthState>().requestOtp(_digits);
      final dev = res['devCode']?.toString();
      Haptics.success();
      setState(() {
        _devCode = dev;
        // Подставляем сразу: перебивать вручную код, который и так на
        // экране, — бессмысленная работа на каждом тестовом заказе.
        if (dev != null) _code.text = dev;
        _codeSent = true;
        _busy = false;
      });
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
    return text.isEmpty || text.length > 120
        ? S.tryAgainShort
        : text;
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
                _codeSent ? S.smsCodeTitle : S.yourPhone,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: Gap.sm),
              Text(
                _codeSent
                    ? S.sentTo(_phone.text)
                    : S.smsInsteadOfPassword,
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
                ),

              if (_devCode != null) ...[
                const SizedBox(height: Gap.md),
                Container(
                  padding: const EdgeInsets.all(Gap.md),
                  decoration: BoxDecoration(
                    color: c.accentSoft,
                    borderRadius: R.field,
                  ),
                  child: Text(
                    S.testModeCode(_devCode!),
                    style: TextStyle(fontSize: 12.5, height: 1.4, color: c.accent),
                  ),
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

              if (_codeSent) ...[
                const SizedBox(height: Gap.md),
                PressScale(
                  onTap: _busy
                      ? null
                      : () => setState(() {
                          _codeSent = false;
                          _code.clear();
                          _error = null;
                        }),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Gap.sm),
                    child: Text(
                      S.changePhone,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: c.accent,
                      ),
                    ),
                  ),
                ),
              ],
            ],
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

  const _Field({
    required this.controller,
    required this.hint,
    required this.keyboard,
    required this.formatters,
    required this.autofocus,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return TextField(
      controller: controller,
      keyboardType: keyboard,
      inputFormatters: formatters,
      autofocus: autofocus,
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
