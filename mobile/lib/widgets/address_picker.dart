import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import 'package:flutter/services.dart';
import '../utils/haptics.dart';
import '../utils/input_validation.dart';
import '../widgets/motion.dart';

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
class AddressPicker extends StatefulWidget {
  final TextEditingController street;
  final TextEditingController house;

  const AddressPicker({super.key, required this.street, required this.house});

  @override
  State<AddressPicker> createState() => AddressPickerState();
}

class AddressPickerState extends State<AddressPicker> {
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
        FieldCard(
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
        FieldCard(
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
              style: TextStyle(fontSize: 11.5, color: c.accent),
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

class FieldCard extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final List<TextInputFormatter>? formatters;
  final TextInputType? keyboard;
  final String? Function(String?)? validator;
  final int maxLines;
  final bool capitalize;
  final ValueChanged<String>? onChanged;

  const FieldCard({
    super.key,
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
        // Фон страницы, а не «светлое»: поле должно быть цветом того, на
        // чём лежит, — рамка и так его очерчивает. Иначе в тёмной теме
        // получается белый прямоугольник со светлым текстом внутри.
        fillColor: c.page,
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
