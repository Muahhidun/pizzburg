import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import '../utils/input_validation.dart';
import 'order_screen.dart';
import '../state/auth.dart';

/// Оформление заказа: тип, контакты, адрес, способ оплаты.
class CheckoutScreen extends StatefulWidget {
  final CartPreview preview;
  const CheckoutScreen({super.key, required this.preview});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  String _type = 'DELIVERY';
  String _payment = 'CASH';
  final _name = TextEditingController();
  final _phone = TextEditingController(text: '+7 ');
  final _street = TextEditingController();
  final _house = TextEditingController();
  final _flat = TextEditingController();
  final _entrance = TextEditingController();
  final _floor = TextEditingController();
  final _comment = TextEditingController();
  final _points = TextEditingController(text: '0');
  bool _sending = false;
  bool _skipPromotions = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (!widget.preview.deliveryAvailable) _type = 'PICKUP';
    WidgetsBinding.instance.addPostFrameCallback((_) => _prefillProfile());
  }

  void _prefillProfile() {
    final auth = context.read<AuthState>();
    if (!auth.isAuthenticated) return;
    setState(() {
      _phone.text = auth.phone;
      if (_name.text.isEmpty && auth.name.isNotEmpty) _name.text = auth.name;
    });
  }

  @override
  void dispose() {
    for (final controller in [
      _name,
      _phone,
      _street,
      _house,
      _flat,
      _entrance,
      _floor,
      _comment,
      _points,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  int get _pointsToSpend {
    if (!context.read<AuthState>().isAuthenticated) return 0;
    return int.tryParse(_points.text) ?? 0;
  }

  int get _total =>
      widget.preview.subtotal +
      (_type == 'DELIVERY' ? widget.preview.deliveryFee : 0) -
      _pointsToSpend.clamp(0, widget.preview.subtotal);

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _sending = true;
      _error = null;
    });

    final cart = context.read<Cart>();
    try {
      final order = await context.read<ApiClient>().createOrder({
        'type': _type,
        'phone': _phone.text.trim(),
        if (_name.text.trim().isNotEmpty) 'name': _name.text.trim(),
        'paymentMethod': _payment,
        if (_pointsToSpend > 0) 'pointsToSpend': _pointsToSpend,
        if (_pointsToSpend > 0 && _skipPromotions) 'skipPromotions': true,
        if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim(),
        if (_type == 'DELIVERY')
          'address': {
            'street': _street.text.trim(),
            'house': _house.text.trim(),
            if (_flat.text.trim().isNotEmpty) 'flat': _flat.text.trim(),
            if (_entrance.text.trim().isNotEmpty)
              'entrance': _entrance.text.trim(),
            if (_floor.text.trim().isNotEmpty) 'floor': _floor.text.trim(),
          },
        'items': cart.toApiItems(),
      });
      if (!mounted) return;
      final auth = context.read<AuthState>();
      if (auth.isAuthenticated) await auth.refresh();
      if (!mounted) return;
      cart.clear();
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => OrderScreen(order: order)),
        (route) => route.isFirst,
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _sending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Оформление',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        backgroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _Section(
              title: 'Способ получения',
              child: Row(
                children: [
                  Expanded(
                    child: _Choice(
                      label: 'Доставка',
                      selected: _type == 'DELIVERY',
                      enabled: widget.preview.deliveryAvailable,
                      onTap: () => setState(() => _type = 'DELIVERY'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _Choice(
                      label: 'Самовывоз',
                      selected: _type == 'PICKUP',
                      onTap: () => setState(() => _type = 'PICKUP'),
                    ),
                  ),
                ],
              ),
            ),
            _Section(
              title: 'Контакты',
              child: Column(
                children: [
                  TextFormField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    inputFormatters: [KzPhoneInputFormatter()],
                    decoration: _input('Телефон', hint: '+7 707 000 00 00'),
                    validator: validateKzPhone,
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    inputFormatters: nameInputFormatters,
                    decoration: _input('Имя'),
                    validator: validateName,
                  ),
                ],
              ),
            ),
            if (_type == 'DELIVERY')
              _Section(
                title: 'Адрес доставки',
                child: Column(
                  children: [
                    TextFormField(
                      controller: _street,
                      textCapitalization: TextCapitalization.words,
                      inputFormatters: streetInputFormatters,
                      decoration: _input('Улица'),
                      validator: validateStreet,
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _house,
                            inputFormatters: houseInputFormatters,
                            decoration: _input('Дом'),
                            validator: validateHouse,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextFormField(
                            controller: _flat,
                            inputFormatters: flatInputFormatters,
                            decoration: _input('Квартира'),
                            validator: validateFlat,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _entrance,
                            keyboardType: TextInputType.number,
                            inputFormatters: entranceInputFormatters,
                            decoration: _input('Подъезд'),
                            validator: validateEntrance,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextFormField(
                            controller: _floor,
                            keyboardType: const TextInputType.numberWithOptions(
                              signed: true,
                            ),
                            inputFormatters: floorInputFormatters,
                            decoration: _input('Этаж'),
                            validator: validateFloor,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            _LoyaltySection(
              controller: _points,
              subtotal: widget.preview.subtotal,
              cashbackPct: widget.preview.cashbackPct,
              hasPromotion: widget.preview.appliedPromotions.isNotEmpty,
              earnWhenPointsSpent: widget.preview.earnWhenPointsSpent,
              allowPointsWithPromotions:
                  widget.preview.allowPointsWithPromotions,
              earnOnPromotionalOrders: widget.preview.earnOnPromotionalOrders,
              skipPromotions: _skipPromotions,
              onChoosePointsInstead: () => setState(() {
                _skipPromotions = true;
              }),
              onRestorePromotion: () => setState(() {
                _skipPromotions = false;
                _points.text = '0';
              }),
              onChanged: () => setState(() {}),
              onLoggedIn: _prefillProfile,
            ),
            _Section(
              title: 'Оплата',
              child: Column(
                children: [
                  _PaymentOption(
                    label: 'Наличными',
                    value: 'CASH',
                    group: _payment,
                    onChanged: (v) => setState(() => _payment = v),
                  ),
                  _PaymentOption(
                    label: 'Картой курьеру',
                    value: 'CARD_ON_DELIVERY',
                    group: _payment,
                    onChanged: (v) => setState(() => _payment = v),
                  ),
                  _PaymentOption(
                    label: 'Kaspi онлайн',
                    value: 'KASPI_ONLINE',
                    subtitle: 'Скоро',
                    enabled: false,
                    group: _payment,
                    onChanged: (v) => setState(() => _payment = v),
                  ),
                ],
              ),
            ),
            _Section(
              title: 'Комментарий',
              child: TextFormField(
                controller: _comment,
                maxLines: 2,
                inputFormatters: commentInputFormatters,
                decoration: _input('Например: домофон не работает'),
                validator: validateComment,
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SizedBox(
            height: 56,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.black,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed: _sending ? null : _submit,
              child: _sending
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      'Заказать · ${formatTenge(_total)}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _input(String label, {String? hint}) => InputDecoration(
    labelText: label,
    hintText: hint,
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide.none,
    ),
  );
}

class _LoyaltySection extends StatelessWidget {
  final TextEditingController controller;
  final int subtotal;
  final int cashbackPct;
  final bool hasPromotion;
  final bool earnWhenPointsSpent;
  final bool allowPointsWithPromotions;
  final bool earnOnPromotionalOrders;
  final bool skipPromotions;
  final VoidCallback onChoosePointsInstead;
  final VoidCallback onRestorePromotion;
  final VoidCallback onChanged;
  final VoidCallback onLoggedIn;

  const _LoyaltySection({
    required this.controller,
    required this.subtotal,
    required this.cashbackPct,
    required this.hasPromotion,
    required this.earnWhenPointsSpent,
    required this.allowPointsWithPromotions,
    required this.earnOnPromotionalOrders,
    required this.skipPromotions,
    required this.onChoosePointsInstead,
    required this.onRestorePromotion,
    required this.onChanged,
    required this.onLoggedIn,
  });

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    if (!auth.isAuthenticated) {
      return _Section(
        title: 'Кэшбэк приложения',
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'Войдите по телефону, чтобы копить и использовать баллы',
                ),
              ),
              TextButton(
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (_) => const LoyaltyLoginDialog(),
                  );
                  if (ok == true) onLoggedIn();
                },
                child: const Text('Войти'),
              ),
            ],
          ),
        ),
      );
    }

    final maxPoints = auth.pointsBalance < subtotal
        ? auth.pointsBalance
        : subtotal;
    final pointsBlockedByPromotion =
        hasPromotion && !allowPointsWithPromotions && !skipPromotions;
    final spending = (int.tryParse(controller.text) ?? 0).clamp(0, maxPoints);
    final promotionWillApply = hasPromotion && !skipPromotions;
    final cashbackBlocked =
        (spending > 0 && !earnWhenPointsSpent) ||
        (promotionWillApply && !earnOnPromotionalOrders);
    final earning = cashbackBlocked
        ? 0
        : ((subtotal - spending) * cashbackPct / 100).floor();
    return _Section(
      title: 'Баллы',
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Доступно: ${auth.pointsBalance} баллов',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 10),
            if (pointsBlockedByPromotion) ...[
              const Text(
                'В корзине действует акция. По правилам заведения акция и баллы не суммируются.',
                style: TextStyle(fontSize: 13, color: Colors.black54),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: maxPoints == 0 ? null : onChoosePointsInstead,
                child: const Text('Использовать баллы вместо акции'),
              ),
            ] else ...[
              if (hasPromotion && skipPromotions) ...[
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Акция отключится для этого заказа.',
                        style: TextStyle(fontSize: 13, color: Colors.black54),
                      ),
                    ),
                    TextButton(
                      onPressed: onRestorePromotion,
                      child: const Text('Вернуть акцию'),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
              ],
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: controller,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: _pointsInput('Списать баллов'),
                      onChanged: (_) => onChanged(),
                      validator: (value) {
                        final amount = int.tryParse(value ?? '') ?? 0;
                        if (amount > maxPoints) return 'Максимум $maxPoints';
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: maxPoints == 0
                        ? null
                        : () {
                            controller.text = '$maxPoints';
                            onChanged();
                          },
                    child: const Text('Использовать все'),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 8),
            Text(
              cashbackBlocked
                  ? spending > 0 && !earnWhenPointsSpent
                        ? 'За заказ с оплатой баллами кэшбэк не начисляется'
                        : 'За акционный заказ кэшбэк не начисляется'
                  : earning > 0
                  ? 'После выполнения заказа начислим примерно $earning баллов ($cashbackPct%)'
                  : 'Кэшбэк начисляется после выполнения заказа',
              style: const TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  static InputDecoration _pointsInput(String label) => InputDecoration(
    labelText: label,
    filled: true,
    fillColor: const Color(0xFFF6F6F6),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide.none,
    ),
  );
}

class LoyaltyLoginDialog extends StatefulWidget {
  const LoyaltyLoginDialog({super.key});

  @override
  State<LoyaltyLoginDialog> createState() => _LoyaltyLoginDialogState();
}

class _LoyaltyLoginDialogState extends State<LoyaltyLoginDialog> {
  final _phone = TextEditingController(text: '+7 ');
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _devCode;
  String? _error;

  @override
  void initState() {
    super.initState();
    final saved = context.read<AuthState>().phone;
    if (saved.isNotEmpty) _phone.text = saved;
  }

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _request() async {
    final validation = validateKzPhone(_phone.text);
    if (validation != null) {
      setState(() => _error = validation);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await context.read<AuthState>().requestOtp(
        _phone.text.trim(),
      );
      if (mounted) {
        setState(() {
          _codeSent = true;
          _devCode = result['devCode']?.toString();
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (!RegExp(r'^\d{4}$').hasMatch(_code.text)) {
      setState(() => _error = 'Введите код из 4 цифр');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthState>().verifyOtp(_phone.text.trim(), _code.text);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Вход в профиль'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _phone,
            enabled: !_codeSent,
            keyboardType: TextInputType.phone,
            inputFormatters: [KzPhoneInputFormatter()],
            decoration: const InputDecoration(labelText: 'Телефон'),
          ),
          if (_codeSent) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _code,
              autofocus: true,
              keyboardType: TextInputType.number,
              maxLength: 4,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: 'Код из SMS',
                helperText: _devCode == null ? null : 'Тестовый код: $_devCode',
              ),
            ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: _busy ? null : (_codeSent ? _verify : _request),
          child: Text(
            _busy ? 'Подождите…' : (_codeSent ? 'Войти' : 'Получить код'),
          ),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final Widget child;
  const _Section({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _Choice({
    required this.label,
    required this.selected,
    this.enabled = true,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? Colors.black : Colors.white,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: !enabled
                ? Colors.black26
                : selected
                ? Colors.white
                : Colors.black,
          ),
        ),
      ),
    );
  }
}

class _PaymentOption extends StatelessWidget {
  final String label;
  final String value;
  final String group;
  final String? subtitle;
  final bool enabled;
  final ValueChanged<String> onChanged;

  const _PaymentOption({
    required this.label,
    required this.value,
    required this.group,
    this.subtitle,
    this.enabled = true,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final selected = group == value;

    return GestureDetector(
      onTap: enabled ? () => onChanged(value) : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? Colors.black : Colors.transparent,
            width: 1.5,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 20,
              color: !enabled
                  ? Colors.black12
                  : selected
                  ? Colors.black
                  : Colors.black26,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 15,
                      color: enabled ? Colors.black : Colors.black38,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black38,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
