import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/address_picker.dart';
import '../widgets/motion.dart';
import '../i18n/strings.dart';

/// Добавление адреса с главного экрана.
///
/// Вторая точка входа к тому же действию, и это осознанный повтор.
/// Человек, который первым делом хочет сменить адрес доставки, не должен
/// для этого набирать корзину и доходить до оформления. Ввод при этом
/// один и тот же виджет — двух реализаций нет, чинить в одном месте.
class AddAddressScreen extends StatefulWidget {
  const AddAddressScreen({super.key});

  @override
  State<AddAddressScreen> createState() => _AddAddressScreenState();
}

class _AddAddressScreenState extends State<AddAddressScreen> {
  final _street = TextEditingController();
  final _house = TextEditingController();
  final _flat = TextEditingController();
  final _entrance = TextEditingController();
  final _floor = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _street.dispose();
    _house.dispose();
    _flat.dispose();
    _entrance.dispose();
    _floor.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_street.text.trim().isEmpty || _house.text.trim().isEmpty) {
      setState(() => _error = S.pickStreetFromHints);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await context.read<ApiClient>().saveAddress(
        street: _street.text.trim(),
        house: _house.text.trim(),
        flat: _flat.text.trim(),
        entrance: _entrance.text.trim(),
        floor: _floor.text.trim(),
      );
      if (!mounted) return;
      Haptics.success();
      Navigator.pop(context, true);
    } catch (e) {
      await Haptics.warning();
      if (mounted) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
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
                  S.newAddressTitle,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ],
            ),
            const SizedBox(height: Gap.block),

            AddressPicker(street: _street, house: _house),
            const SizedBox(height: Gap.md),
            Row(
              children: [
                Expanded(child: FieldCard(label: S.flatLabel, controller: _flat)),
                const SizedBox(width: Gap.sm),
                Expanded(
                  child: FieldCard(label: S.entranceLabel, controller: _entrance),
                ),
                const SizedBox(width: Gap.sm),
                Expanded(child: FieldCard(label: S.floorLabel, controller: _floor)),
              ],
            ),

            if (_error != null) ...[
              const SizedBox(height: Gap.md),
              Text(_error!, style: TextStyle(fontSize: 13, color: c.accent)),
            ],

            const SizedBox(height: Gap.block),
            PressScale(
              onTap: _saving ? null : _save,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 16),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.accent, borderRadius: R.pill),
                child: Text(
                  _saving ? S.saving : S.saveAddress,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: c.surface,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
