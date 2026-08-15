import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../utils/input_validation.dart';
import '../widgets/motion.dart';
import 'legal_screen.dart';
import 'order_screen.dart';

/// Оформление заказа по прототипу «Сигнал».
///
/// Кнопка «Заказать» — единственная маджентовая кнопка в приложении.
/// Это финал пути, и он окрашен цветом выгоды намеренно: человек не
/// «отправляет форму», а получает то, ради чего пришёл.
class CheckoutScreen extends StatefulWidget {
  final CartPreview preview;

  /// Сколько баллов клиент выбрал в корзине — оформление их не переспрашивает
  final int initialPoints;

  const CheckoutScreen({
    super.key,
    required this.preview,
    this.initialPoints = 0,
  });

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

  List<SavedAddress> _addresses = const [];
  String? _selectedAddressId;
  bool _newAddress = false;

  int _points = 0;
  int? _changeFrom;
  bool _sending = false;
  final bool _skipPromotions = false;
  String? _error;

  PreorderSlot? _slot;
  List<PreorderSlot> _slots = [];

  static const _changeOptions = [5000, 10000, 20000];

  Availability get _availability => widget.preview.availability;

  @override
  void initState() {
    super.initState();
    if (!widget.preview.deliveryAvailable) _type = 'PICKUP';
    _payment = _firstEnabledPayment();
    _points = widget.initialPoints;
    _loadSlots();
    WidgetsBinding.instance.addPostFrameCallback((_) => _prefillProfile());
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _phone,
      _street,
      _house,
      _flat,
      _entrance,
      _floor,
      _comment,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String _firstEnabledPayment() {
    if (_availability.cashEnabled) return 'CASH';
    if (_availability.cardOnDeliveryEnabled) return 'CARD_ON_DELIVERY';
    return 'KASPI_ONLINE';
  }

  Future<void> _loadSlots() async {
    try {
      final slots = await context.read<ApiClient>().preorderSlots(_type);
      if (!mounted) return;
      setState(() {
        _slots = slots;
        // Когда «побыстрее» недоступно, сразу подставляем ближайший слот,
        // чтобы клиент не упёрся в ошибку сервера в самом конце.
        if (!_availability.asapAvailable && _slot == null && slots.isNotEmpty) {
          _slot = slots.first;
        }
      });
    } catch (_) {}
  }

  void _prefillProfile() {
    final auth = context.read<AuthState>();
    if (!auth.isAuthenticated) return;
    setState(() {
      _phone.text = auth.phone;
      if (_name.text.isEmpty && auth.name.isNotEmpty) _name.text = auth.name;
    });
    _loadAddresses();
  }

  Future<void> _loadAddresses() async {
    try {
      final list = await context.read<ApiClient>().fetchAddresses();
      if (!mounted || list.isEmpty) return;
      setState(() {
        _addresses = list;
        _applyAddress(list.first);
      });
    } catch (_) {}
  }

  void _applyAddress(SavedAddress a) {
    _selectedAddressId = a.id;
    _newAddress = false;
    _street.text = a.street;
    _house.text = a.house;
    _flat.text = a.flat;
    _entrance.text = a.entrance;
    _floor.text = a.floor;
  }

  int get _total =>
      widget.preview.subtotal +
      (_type == 'DELIVERY' ? widget.preview.deliveryFee : 0) -
      _points.clamp(0, widget.preview.subtotal);

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      await Haptics.warning();
      return;
    }
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
        if (_slot != null) 'scheduledAt': _slot!.at.toUtc().toIso8601String(),
        if (_payment == 'CASH' && (_changeFrom ?? 0) > 0)
          'changeFrom': _changeFrom,
        if (_points > 0) 'pointsToSpend': _points,
        if (_points > 0 && _skipPromotions) 'skipPromotions': true,
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
      // Запоминаем заказ на устройстве: гость не входит в профиль, и без
      // этого вернуться к статусу после закрытия приложения было бы нельзя.
      await LastPlacedOrder.remember(order.id, order.number, order.total);
      if (!mounted) return;
      Haptics.success();
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
      await Haptics.warning();
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
    final c = context.colors;
    final delivery = _type == 'DELIVERY';

    return Scaffold(
      backgroundColor: c.surface,
      body: SafeArea(
        bottom: false,
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Gap.screen,
              Gap.md,
              Gap.screen,
              Gap.blockWide,
            ),
            children: [
              Row(
                children: [
                  PressScale(
                    onTap: () => Navigator.pop(context),
                    child: Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: c.fillSoft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.arrow_back, size: 18, color: c.ink),
                    ),
                  ),
                  const SizedBox(width: Gap.md),
                  Text(
                    'Оформление',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                ],
              ),
              const SizedBox(height: Gap.block),

              if (_availability.message != null) ...[
                Container(
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    color: c.warnSoft,
                    borderRadius: R.field,
                  ),
                  child: Text(
                    _availability.message!,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: c.warnText,
                    ),
                  ),
                ),
                const SizedBox(height: Gap.lg),
              ],

              // ─── Адрес ───────────────────────────────────────────
              if (delivery)
                _Bordered(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Куда привезти',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: c.muted,
                        ),
                      ),
                      const SizedBox(height: Gap.md),
                      for (final a in _addresses)
                        Padding(
                          padding: const EdgeInsets.only(bottom: Gap.sm),
                          child: _AddressRow(
                            address: a,
                            selected: !_newAddress && _selectedAddressId == a.id,
                            onTap: () => setState(() => _applyAddress(a)),
                          ),
                        ),
                      if (_newAddress || _addresses.isEmpty)
                        _AddressForm(
                          street: _street,
                          house: _house,
                          flat: _flat,
                          entrance: _entrance,
                          floor: _floor,
                        )
                      else
                        PressScale(
                          onTap: () => setState(() {
                            _newAddress = true;
                            _selectedAddressId = null;
                            for (final f in [
                              _street,
                              _house,
                              _flat,
                              _entrance,
                              _floor,
                            ]) {
                              f.clear();
                            }
                          }),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: Gap.sm),
                            child: Text(
                              '+ Новый адрес',
                              style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: c.accent,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                )
              else
                _Bordered(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Откуда забрать',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: c.muted,
                        ),
                      ),
                      const SizedBox(height: Gap.sm),
                      const Text(
                        'Ауэзова 47б, ТРЦ «MaxiMall», 3 этаж',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),

              const SizedBox(height: Gap.md),

              // ─── Имя и телефон ───────────────────────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _FieldCard(
                      label: 'Имя',
                      controller: _name,
                      formatters: nameInputFormatters,
                      validator: validateName,
                      capitalize: true,
                    ),
                  ),
                  const SizedBox(width: Gap.sm),
                  Expanded(
                    child: _FieldCard(
                      label: 'Телефон',
                      controller: _phone,
                      formatters: [KzPhoneInputFormatter()],
                      keyboard: TextInputType.phone,
                      validator: validateKzPhone,
                    ),
                  ),
                ],
              ),

              // ─── Время ───────────────────────────────────────────
              const SizedBox(height: Gap.blockWide),
              const _Label('Время'),
              const SizedBox(height: Gap.md),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  if (_availability.asapAvailable)
                    _Chip(
                      label: 'Ближайшее',
                      selected: _slot == null,
                      onTap: () => setState(() => _slot = null),
                    ),
                  for (final slot in _slots.take(4))
                    _Chip(
                      label: slot.label,
                      selected: _slot?.at == slot.at,
                      onTap: () => setState(() => _slot = slot),
                    ),
                ],
              ),

              // ─── Оплата ──────────────────────────────────────────
              const SizedBox(height: Gap.blockWide),
              const _Label('Оплата'),
              const SizedBox(height: Gap.md),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  if (_availability.cashEnabled)
                    _Chip(
                      label: 'Наличными',
                      selected: _payment == 'CASH',
                      onTap: () => setState(() => _payment = 'CASH'),
                    ),
                  if (_availability.cardOnDeliveryEnabled)
                    _Chip(
                      label: 'Картой курьеру',
                      selected: _payment == 'CARD_ON_DELIVERY',
                      onTap: () =>
                          setState(() => _payment = 'CARD_ON_DELIVERY'),
                    ),
                  _Chip(
                    label: 'Онлайн',
                    selected: false,
                    disabled: true,
                    onTap: () {},
                  ),
                ],
              ),

              if (_payment == 'CASH' && _availability.askChangeFrom) ...[
                const SizedBox(height: Gap.md),
                Container(
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    color: c.fillSoft,
                    borderRadius: R.field,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Подготовить сдачу с',
                        style: TextStyle(fontSize: 13, color: c.muted),
                      ),
                      const SizedBox(height: Gap.md),
                      Wrap(
                        spacing: 7,
                        children: [
                          for (final amount in _changeOptions)
                            _Chip(
                              label: formatTenge(amount, withCurrency: false),
                              selected: _changeFrom == amount,
                              // Повторный тап снимает выбор: человек мог
                              // передумать и заплатить без сдачи.
                              onTap: () => setState(
                                () => _changeFrom =
                                    _changeFrom == amount ? null : amount,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],

              // ─── Комментарий ─────────────────────────────────────
              const SizedBox(height: Gap.blockWide),
              _FieldCard(
                label: 'Комментарий курьеру',
                controller: _comment,
                maxLines: 2,
              ),

              if (_error != null) ...[
                const SizedBox(height: Gap.lg),
                Text(
                  _error!,
                  style: TextStyle(fontSize: 13, color: c.accent),
                ),
              ],

              const SizedBox(height: Gap.block),
              _ConsentText(),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            Gap.screen,
            0,
            Gap.screen,
            Gap.md + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: PressScale(
            onTap: _sending ? null : _submit,
            child: Container(
              padding: const EdgeInsets.fromLTRB(22, 12, 12, 12),
              decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  AnimatedMoney(
                    _total,
                    style: Theme.of(
                      context,
                    ).textTheme.titleLarge?.copyWith(color: c.surface),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 22,
                      vertical: 15,
                    ),
                    decoration: BoxDecoration(
                      // Единственная маджентовая кнопка в приложении:
                      // это финал пути, а не очередная отправка формы.
                      color: _sending ? c.muted : c.benefit,
                      borderRadius: R.pill,
                    ),
                    child: Text(
                      _sending ? 'Отправляем…' : 'Заказать',
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: c.ink,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
  );
}

class _Bordered extends StatelessWidget {
  final Widget child;
  const _Bordered({required this.child});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(Gap.lg),
    decoration: BoxDecoration(
      borderRadius: R.block,
      border: Border.all(color: context.colors.border, width: 1.5),
    ),
    child: child,
  );
}

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final bool disabled;
  final VoidCallback onTap;

  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.disabled = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale.selection(
      onTap: disabled ? null : onTap,
      child: AnimatedContainer(
        duration: Motion.base,
        curve: Motion.change,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        decoration: BoxDecoration(
          color: selected ? c.ink : c.surface,
          borderRadius: R.pill,
          border: selected ? null : Border.all(color: c.border, width: 1.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: disabled
                    ? c.muted
                    : selected
                        ? c.surface
                        : c.ink,
              ),
            ),
            if (disabled)
              Text(
                'скоро',
                style: TextStyle(fontSize: 11, color: c.muted),
              ),
          ],
        ),
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  final SavedAddress address;
  final bool selected;
  final VoidCallback onTap;

  const _AddressRow({
    required this.address,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final details = [
      if (address.flat.isNotEmpty) 'кв. ${address.flat}',
      if (address.entrance.isNotEmpty) 'подъезд ${address.entrance}',
      if (address.floor.isNotEmpty) 'этаж ${address.floor}',
    ].join(' · ');

    return PressScale.selection(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.base,
        padding: const EdgeInsets.all(Gap.md),
        decoration: BoxDecoration(
          color: selected ? c.accentSoft : const Color(0x0A0E0D10),
          borderRadius: R.field,
        ),
        child: Row(
          children: [
            Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: selected ? c.accent : c.border,
                  width: selected ? 5 : 1.5,
                ),
              ),
            ),
            const SizedBox(width: Gap.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${address.street}, ${address.house}',
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.2,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (details.isNotEmpty)
                    Text(
                      details,
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.35,
                        color: c.muted,
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

/// Форма нового адреса: улица, дом, квартира, подъезд, этаж — отдельными
/// полями, как требует хендофф.
class _AddressForm extends StatelessWidget {
  final TextEditingController street;
  final TextEditingController house;
  final TextEditingController flat;
  final TextEditingController entrance;
  final TextEditingController floor;

  const _AddressForm({
    required this.street,
    required this.house,
    required this.flat,
    required this.entrance,
    required this.floor,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AddressPicker(street: street, house: house),
        const SizedBox(height: Gap.sm),
        _FieldCard(
          label: 'Квартира',
          controller: flat,
          formatters: flatInputFormatters,
          validator: validateFlat,
        ),
        const SizedBox(height: Gap.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _FieldCard(
                label: 'Подъезд',
                controller: entrance,
                keyboard: TextInputType.number,
                formatters: entranceInputFormatters,
                validator: validateEntrance,
              ),
            ),
            const SizedBox(width: Gap.sm),
            Expanded(
              child: _FieldCard(
                label: 'Этаж',
                controller: floor,
                // Именно number, без signed: на iOS «signed» открывает
                // клавиатуру с буквами, а фильтр их не пропускает —
                // поле выглядит сломанным.
                keyboard: TextInputType.number,
                formatters: floorInputFormatters,
                validator: validateFloor,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Поле-карточка с подписью сверху: видно, что это ввод, а не текст.
class _FieldCard extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final List<TextInputFormatter>? formatters;
  final TextInputType? keyboard;
  final String? Function(String?)? validator;
  final int maxLines;
  final bool capitalize;
  final ValueChanged<String>? onChanged;

  const _FieldCard({
    required this.label,
    required this.controller,
    this.formatters,
    this.keyboard,
    this.validator,
    this.maxLines = 1,
    this.capitalize = false,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return TextFormField(
      controller: controller,
      inputFormatters: formatters,
      keyboardType: keyboard,
      maxLines: maxLines,
      validator: validator,
      onChanged: onChanged,
      textCapitalization: capitalize
          ? TextCapitalization.words
          : TextCapitalization.none,
      style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(fontSize: 13, color: c.muted),
        floatingLabelBehavior: FloatingLabelBehavior.always,
        filled: true,
        fillColor: c.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Gap.lg,
          vertical: Gap.md,
        ),
        border: OutlineInputBorder(
          borderRadius: R.field,
          borderSide: BorderSide(color: c.border, width: 1.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: R.field,
          borderSide: BorderSide(color: c.border, width: 1.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: R.field,
          borderSide: BorderSide(color: c.accent, width: 1.5),
        ),
      ),
    );
  }
}

class _ConsentText extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final link = TextStyle(fontSize: 9.5, height: 1.45, color: c.accent);

    return Wrap(
      children: [
        Text(
          'Нажимая кнопку, вы соглашаетесь с ',
          style: TextStyle(fontSize: 9.5, height: 1.45, color: c.muted),
        ),
        GestureDetector(
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const LegalDocumentScreen(
                type: 'OFFER',
                title: 'Публичная оферта',
              ),
            ),
          ),
          child: Text('офертой', style: link),
        ),
        Text(
          ' и ',
          style: TextStyle(fontSize: 9.5, height: 1.45, color: c.muted),
        ),
        GestureDetector(
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const LegalDocumentScreen(
                type: 'PRIVACY',
                title: 'Политика конфиденциальности',
              ),
            ),
          ),
          child: Text('политикой обработки данных', style: link),
        ),
      ],
    );
  }
}

/// Выбор адреса из справочника города.
///
/// Свободный ввод улицы убран намеренно: курьер поедет по тому, что
/// написал клиент, и «Сатпаево 38» вместо «Сатпаева, 38А» стоит рейса.
/// Сначала выбирается улица, потом дом из домов этой улицы — на улице
/// Беркимбаева 217 домов, и показывать их до выбора улицы бессмысленно.
///
/// Справочник закрытый, но не глухой: у него есть «моего адреса нет».
/// Без этой лазейки новый дом или переименованная улица однажды просто не
/// дадут человеку заказать, и мы узнаем об этом только по выручке.
class _AddressPicker extends StatefulWidget {
  final TextEditingController street;
  final TextEditingController house;

  const _AddressPicker({required this.street, required this.house});

  @override
  State<_AddressPicker> createState() => _AddressPickerState();
}

class _AddressPickerState extends State<_AddressPicker> {
  List<AddressSuggestion> _streets = const [];
  List<AddressSuggestion> _houses = const [];
  bool _streetPicked = false;
  bool _manual = false;
  bool _requestSent = false;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onStreetChanged(String value) {
    _streetPicked = false;
    setState(() => _houses = const []);
    _debounce?.cancel();
    // Запрос на каждую букву мигает списком под пальцем
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      if (value.trim().length < 3) {
        if (mounted) setState(() => _streets = const []);
        return;
      }
      try {
        final items = await context.read<ApiClient>().suggestAddress(value);
        if (mounted) setState(() => _streets = items);
      } catch (_) {
        if (mounted) setState(() => _streets = const []);
      }
    });
  }

  Future<void> _pickStreet(AddressSuggestion s) async {
    Haptics.selection();
    widget.street.text = s.street;
    // Человек мог ввести «абая 38» одной строкой — тогда дом уже известен
    if (s.house.isNotEmpty) widget.house.text = s.house;
    setState(() {
      _streets = const [];
      _streetPicked = true;
      _houses = const [];
    });
    if (s.house.isEmpty) await _loadHouses('');
  }

  Future<void> _loadHouses(String query) async {
    final street = widget.street.text.trim();
    if (street.isEmpty) return;
    try {
      final items = await context.read<ApiClient>().fetchHouses(street, query);
      if (mounted) setState(() => _houses = items);
    } catch (_) {
      if (mounted) setState(() => _houses = const []);
    }
  }

  void _onHouseChanged(String value) {
    if (!_streetPicked) return;
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 200),
      () => _loadHouses(value),
    );
  }

  void _pickHouse(AddressSuggestion s) {
    Haptics.selection();
    setState(() {
      widget.house.text = s.house;
      _houses = const [];
    });
    FocusScope.of(context).nextFocus();
  }

  /// Заявка уходит оператору, а поля открываются на свободный ввод: заказ
  /// при этом не блокируется.
  Future<void> _switchToManual() async {
    Haptics.tap();
    setState(() {
      _manual = true;
      _streets = const [];
      _houses = const [];
    });
    final typed = widget.street.text.trim();
    if (typed.isEmpty) return;
    try {
      await context.read<ApiClient>().requestAddress(typed);
      if (mounted) setState(() => _requestSent = true);
    } catch (_) {
      // Заявка — удобство для нас, а не условие заказа
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldCard(
          label: 'Улица',
          controller: widget.street,
          formatters: streetInputFormatters,
          validator: validateStreet,
          capitalize: true,
          onChanged: _manual ? null : _onStreetChanged,
        ),
        if (_streets.isNotEmpty)
          _SuggestList(
            items: _streets,
            icon: Icons.place_outlined,
            onTap: _pickStreet,
          ),

        const SizedBox(height: Gap.sm),
        _FieldCard(
          label: 'Дом',
          controller: widget.house,
          formatters: houseInputFormatters,
          validator: validateHouse,
          onChanged: _manual ? null : _onHouseChanged,
        ),
        if (_houses.isNotEmpty)
          _SuggestList(
            items: _houses,
            icon: Icons.home_outlined,
            labelOf: (s) => s.house,
            onTap: _pickHouse,
          ),

        if (_manual)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm, left: Gap.xs),
            child: Text(
              _requestSent
                  ? 'Записали. Оператор проверит адрес перед доставкой'
                  : 'Оператор проверит адрес перед доставкой',
              style: TextStyle(fontSize: 11.5, color: c.warnText),
            ),
          )
        else if (_streetPicked)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm, left: Gap.xs),
            child: Text(
              // Пока дом не выбран, проверена только улица — обещать
              // «адрес есть» рано, это разные утверждения.
              widget.house.text.trim().isEmpty
                  ? 'Улица есть в справочнике города'
                  : 'Адрес есть в справочнике города',
              style: TextStyle(fontSize: 11.5, color: c.benefit),
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm),
            child: PressScale(
              onTap: _switchToManual,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Gap.xs,
                  vertical: Gap.xs,
                ),
                child: Text(
                  'Моего адреса нет в списке',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: c.muted,
                    decoration: TextDecoration.underline,
                    decorationColor: c.muted,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Список подсказок под полем
class _SuggestList extends StatelessWidget {
  final List<AddressSuggestion> items;
  final IconData icon;
  final String Function(AddressSuggestion)? labelOf;
  final void Function(AddressSuggestion) onTap;

  const _SuggestList({
    required this.items,
    required this.icon,
    required this.onTap,
    this.labelOf,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.only(top: 6),
      // Ограничиваем высоту: домов на улице бывает две сотни, и список
      // не должен выталкивать кнопку оформления за экран.
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: ListView.builder(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        itemCount: items.length,
        itemBuilder: (context, i) {
          final item = items[i];
          return PressScale(
            onTap: () => onTap(item),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: Gap.lg,
                vertical: Gap.md,
              ),
              child: Row(
                children: [
                  Icon(icon, size: 16, color: c.muted),
                  const SizedBox(width: Gap.sm),
                  Expanded(
                    child: Text(
                      labelOf?.call(item) ?? item.label,
                      style: const TextStyle(fontSize: 13.5),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
