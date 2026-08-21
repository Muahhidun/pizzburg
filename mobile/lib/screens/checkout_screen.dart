import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import 'catalog_parts.dart';
import '../widgets/address_picker.dart';
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
      // Адрес, выбранный на главном, должен доехать сюда: иначе человек
      // выбирает его дважды и во второй раз может выбрать не тот.
      final chosenId = await SelectedAddress.get();
      if (!mounted) return;
      setState(() {
        _addresses = list;
        _applyAddress(
          list.firstWhere((a) => a.id == chosenId, orElse: () => list.first),
        );
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

              // ─── Способ получения ────────────────────────────────
              //
              // Тот же выбор есть в шапке каталога, и это осознанный
              // повтор. Человек кладёт товары, заходит в корзину и только
              // на адресе замечает, что стоит доставка, — без выбора
              // здесь ему пришлось бы выйти назад и начать заново.
              ModeSwitch(
                mode: _type,
                deliveryAvailable: widget.preview.deliveryAvailable,
                onChanged: (m) {
                  if (m == _type) return;
                  Haptics.selection();
                  setState(() => _type = m);
                  // Слоты предзаказа у доставки и самовывоза разные:
                  // готовят по-разному, и время не совпадает.
                  _loadSlots();
                },
              ),
              const SizedBox(height: Gap.lg),

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
                    child: FieldCard(
                      label: 'Имя',
                      controller: _name,
                      formatters: nameInputFormatters,
                      validator: validateName,
                      capitalize: true,
                    ),
                  ),
                  const SizedBox(width: Gap.sm),
                  Expanded(
                    child: FieldCard(
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
                      // Купюра меньше суммы заказа сдачи не даёт — предлагать
                      // её значит просить кассира готовить размен с 5 000 на
                      // заказ в 9 297. Оставляем только те, что реально
                      // больше чека.
                      Wrap(
                        spacing: 7,
                        children: [
                          for (final amount
                              in _changeOptions.where((a) => a > _total))
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
                          if (_changeOptions.every((a) => a <= _total))
                            Text(
                              'Сумма заказа больше обычных купюр — '
                              'скажите курьеру, с чего готовить сдачу',
                              style: TextStyle(fontSize: 12.5, color: c.muted),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],

              // ─── Комментарий ─────────────────────────────────────
              const SizedBox(height: Gap.blockWide),
              FieldCard(
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

              // Про наплыв говорим здесь, у самой кнопки.
              //
              // Не на витрине: там это отпугивало бы человека до того, как
              // он посмотрел меню, а наплыв — не закрытие, заказ мы берём.
              // И не в начале оформления: решение «готов ли я ждать»
              // принимается в момент нажатия, и предупреждение должно
              // стоять там же, где кнопка.
              if (_availability.rushNotice != null) ...[
                const SizedBox(height: Gap.lg),
                Container(
                  padding: const EdgeInsets.all(Gap.lg),
                  decoration: BoxDecoration(
                    color: c.warnSoft,
                    borderRadius: R.field,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.schedule, size: 16, color: c.warnText),
                      const SizedBox(width: Gap.sm),
                      Expanded(
                        child: Text(
                          _availability.rushNotice!,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.4,
                            color: c.warnText,
                          ),
                        ),
                      ),
                    ],
                  ),
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
        AddressPicker(street: street, house: house),
        const SizedBox(height: Gap.sm),
        FieldCard(
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
              child: FieldCard(
                label: 'Подъезд',
                controller: entrance,
                keyboard: TextInputType.number,
                formatters: entranceInputFormatters,
                validator: validateEntrance,
              ),
            ),
            const SizedBox(width: Gap.sm),
            Expanded(
              child: FieldCard(
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

