import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import 'order_screen.dart';

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
  final _phone = TextEditingController();
  final _street = TextEditingController();
  final _house = TextEditingController();
  final _flat = TextEditingController();
  final _entrance = TextEditingController();
  final _floor = TextEditingController();
  final _comment = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (!widget.preview.deliveryAvailable) _type = 'PICKUP';
  }

  int get _total =>
      widget.preview.subtotal +
      (_type == 'DELIVERY' ? widget.preview.deliveryFee : 0);

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
        title: const Text('Оформление',
            style: TextStyle(fontWeight: FontWeight.w800)),
        backgroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
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
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(
                        RegExp(r'[0-9+ ()-]'),
                      ),
                      LengthLimitingTextInputFormatter(18),
                    ],
                    decoration: _input('Телефон', hint: '+7 707 000 00 00'),
                    validator: (v) {
                      final digits = (v ?? '').replaceAll(RegExp(r'\D'), '');
                      final valid = digits.length == 10 ||
                          (digits.length == 11 &&
                              (digits.startsWith('7') ||
                                  digits.startsWith('8')));
                      return valid ? null : 'Укажите корректный телефон';
                    },
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _name,
                    decoration: _input('Имя'),
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
                      decoration: _input('Улица'),
                      validator: (v) => (v == null || v.trim().isEmpty)
                          ? 'Укажите улицу'
                          : null,
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _house,
                            decoration: _input('Дом'),
                            validator: (v) => (v == null || v.trim().isEmpty)
                                ? 'Дом'
                                : null,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextFormField(
                              controller: _flat, decoration: _input('Квартира')),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                              controller: _entrance,
                              decoration: _input('Подъезд')),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextFormField(
                              controller: _floor, decoration: _input('Этаж')),
                        ),
                      ],
                    ),
                  ],
                ),
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
                decoration: _input('Например: домофон не работает'),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!,
                    style: const TextStyle(color: Colors.red)),
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
                    borderRadius: BorderRadius.circular(16)),
              ),
              onPressed: _sending ? null : _submit,
              child: _sending
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : Text('Заказать · ${formatTenge(_total)}',
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
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
          Text(title,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
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
                  Text(label,
                      style: TextStyle(
                          fontSize: 15,
                          color: enabled ? Colors.black : Colors.black38)),
                  if (subtitle != null)
                    Text(subtitle!,
                        style: const TextStyle(
                            fontSize: 12, color: Colors.black38)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
