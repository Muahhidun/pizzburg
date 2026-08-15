import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'checkout_screen.dart';

/// Корзина по прототипу «Сигнал».
///
/// Порядок блоков не случайный: сначала состав, потом выгода (подарок,
/// промокод, баллы), в конце итог. Человек сначала проверяет, что заказал,
/// и только потом занимается экономией.
class CartScreen extends StatefulWidget {
  /// Внутри таб-бара у корзины нет кнопки «назад»: она не открыта поверх
  /// каталога, а является отдельной вкладкой.
  final bool embedded;

  const CartScreen({super.key, this.embedded = false});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  CartPreview? _preview;
  bool _loading = true;
  String? _error;
  int _points = 0;
  final _promo = TextEditingController();
  String? _promoApplied;
  String? _promoError;
  final _pointsHaptic = SteppedHaptic();

  /// Слепок состава, по которому уже посчитано превью.
  ///
  /// Во вкладке экран создаётся один раз — при пустой корзине — и больше
  /// не пересоздаётся. Без сравнения состава превью так и осталось бы
  /// пустым, а вместе с ним пропала бы кнопка «Оформить».
  String? _previewedFor;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _promo.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final cart = context.read<Cart>();
    if (cart.isEmpty) {
      setState(() {
        _preview = null;
        _previewedFor = null;
        _loading = false;
      });
      return;
    }
    final signature = _signatureOf(cart);
    setState(() => _loading = true);
    try {
      final preview = await context.read<ApiClient>().previewCart(
        cart.toApiItems(),
        promoCode: _promoApplied,
      );
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _previewedFor = signature;
        _loading = false;
        _error = null;
        // Состав изменился — списание сбрасываем: иначе оно может
        // превысить новую сумму заказа.
        _points = _points.clamp(0, _maxPoints(preview));
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  int _maxPoints(CartPreview preview) {
    final balance = context.read<AuthState>().pointsBalance;
    return balance < preview.subtotal ? balance : preview.subtotal;
  }

  Future<void> _applyPromo() async {
    final code = _promo.text.trim().toUpperCase();
    if (code.isEmpty) return;
    setState(() {
      _promoApplied = code;
      _promoError = null;
    });
    await _refresh();
    if (!mounted) return;
    final applied = _preview?.appliedPromotions.isNotEmpty ?? false;
    if (applied) {
      Haptics.success();
    } else {
      await Haptics.warning();
      if (mounted) {
        setState(() {
          _promoError = 'Такого промокода нет';
          _promoApplied = null;
        });
      }
    }
  }

  /// Состав корзины строкой: товар, модификаторы, количество
  static String _signatureOf(Cart cart) =>
      cart.lines.map((l) => '${l.key}x${l.qty}').join('|');

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final cart = context.watch<Cart>();
    final preview = _preview;

    // Состав изменился на другом экране — пересчитываем после кадра:
    // setState во время build запрещён.
    if (!cart.isEmpty && !_loading && _previewedFor != _signatureOf(cart)) {
      _previewedFor = _signatureOf(cart);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _refresh();
      });
    }

    return Scaffold(
      backgroundColor: c.surface,
      body: SafeArea(
        bottom: false,
        child: cart.isEmpty
            ? _Empty(embedded: widget.embedded)
            : ListView(
                padding: const EdgeInsets.fromLTRB(
                  Gap.screen,
                  Gap.lg,
                  Gap.screen,
                  Gap.blockWide,
                ),
                children: [
                  Row(
                    children: [
                      if (!widget.embedded)
                        Padding(
                          padding: const EdgeInsets.only(right: Gap.md),
                          child: PressScale(
                            onTap: () => Navigator.pop(context),
                            child: Container(
                              width: 36,
                              height: 36,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: c.fillSoft,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.arrow_back,
                                size: 18,
                                color: c.ink,
                              ),
                            ),
                          ),
                        ),
                      Text(
                        'Корзина',
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: Gap.block),

                  for (final line in cart.lines)
                    _CartRow(
                      line: line,
                      onAdd: () {
                        Haptics.tap();
                        cart.increment(line);
                        _refresh();
                      },
                      onRemove: () {
                        Haptics.tap();
                        cart.decrement(line);
                        _refresh();
                      },
                    ),

                  if (preview != null) ...[
                    for (final gift in preview.gifts)
                      BenefitReveal(child: _GiftRow(gift: gift)),

                    if (preview.nextGift != null)
                      _Hint(
                        text:
                            'Добавьте ещё на ${formatTenge(preview.nextGift!.missing)} — '
                            '${preview.nextGift!.giftName.toLowerCase()} в подарок',
                      ),

                    const SizedBox(height: Gap.lg),
                    _PromoField(
                      controller: _promo,
                      applied: _promoApplied,
                      error: _promoError,
                      onApply: _applyPromo,
                    ),

                    if (context.watch<AuthState>().isAuthenticated) ...[
                      const SizedBox(height: Gap.lg),
                      _PointsBlock(
                        value: _points,
                        max: _maxPoints(preview),
                        balance: context.watch<AuthState>().pointsBalance,
                        onChanged: (v) {
                          _pointsHaptic.onValue(v);
                          setState(() => _points = v.round());
                        },
                      ),
                    ],

                    const SizedBox(height: Gap.blockWide),
                    _Totals(
                      preview: preview,
                      points: _points,
                      promo: _promoApplied,
                    ),
                  ],

                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.only(top: Gap.block),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Gap.block),
                      child: Text(
                        _error!,
                        style: TextStyle(color: c.accent, fontSize: 13),
                      ),
                    ),
                ],
              ),
      ),
      bottomNavigationBar: cart.isEmpty || preview == null
          ? null
          : SafeArea(
              child: Padding(
                // Внутри оболочки кнопка «Оформить» встаёт над стеклянным
                // баром: перекрыть главное действие нельзя.
                padding: EdgeInsets.fromLTRB(
                  Gap.screen,
                  0,
                  Gap.screen,
                  widget.embedded ? Gap.navBar + Gap.lg : Gap.md,
                ),
                child: PressScale(
                  onTap: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => CheckoutScreen(
                          preview: preview,
                          initialPoints: _points,
                        ),
                      ),
                    );
                    if (mounted) _refresh();
                  },
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(22, 12, 12, 12),
                    decoration: BoxDecoration(
                      color: c.accent,
                      borderRadius: R.pill,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        AnimatedMoney(
                          _total(preview),
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(color: c.surface),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 22,
                            vertical: 15,
                          ),
                          decoration: BoxDecoration(
                            color: c.surface,
                            borderRadius: R.pill,
                          ),
                          child: Text(
                            'Оформить',
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

  int _total(CartPreview p) =>
      p.subtotal + p.deliveryFee - _points.clamp(0, p.subtotal);

}

class _CartRow extends StatelessWidget {
  final CartLine line;
  final VoidCallback onAdd;
  final VoidCallback onRemove;

  const _CartRow({
    required this.line,
    required this.onAdd,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final config = line.modifiers.map((m) => m.name).join(' · ');

    return Container(
      padding: const EdgeInsets.symmetric(vertical: Gap.md),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.line)),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: R.thumbCart,
            child: SizedBox(
              width: 58,
              height: 58,
              child: line.product.photoUrl == null ||
                      line.product.photoUrl!.isEmpty
                  ? ColoredBox(color: c.fillSoft)
                  : Image.network(
                      line.product.photoUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => ColoredBox(color: c.fillSoft),
                    ),
            ),
          ),
          const SizedBox(width: Gap.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.product.name,
                  style: const TextStyle(
                    fontSize: 14.5,
                    height: 1.25,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (config.isNotEmpty)
                  Text(
                    config,
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.3,
                      color: c.muted,
                    ),
                  ),
                const SizedBox(height: 3),
                AnimatedMoney(
                  line.total,
                  style: Theme.of(
                    context,
                  ).textTheme.titleMedium?.copyWith(fontSize: 14.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: Gap.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.pill),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PressScale(
                  onTap: onRemove,
                  child: Icon(Icons.remove, size: 16, color: c.ink),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Gap.sm),
                  child: Text(
                    '${line.qty}',
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                PressScale(
                  onTap: onAdd,
                  child: Icon(Icons.add, size: 16, color: c.ink),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Подарок по акции: цена 0 ₸ цветом выгоды и бейдж с условием.
class _GiftRow extends StatelessWidget {
  final CartGift gift;
  const _GiftRow({required this.gift});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Gap.md),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.line)),
      ),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: c.benefitSoft,
              borderRadius: R.thumbCart,
            ),
            child: Icon(Icons.card_giftcard, size: 22, color: c.benefit),
          ),
          const SizedBox(width: Gap.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  gift.name,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '0 ₸',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 14.5,
                    color: c.benefit,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: c.benefitSoft,
              borderRadius: R.pill,
            ),
            child: Text(
              'Подарок',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: c.benefit,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  final String text;
  const _Hint({required this.text});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.only(top: Gap.md),
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(color: c.warnSoft, borderRadius: R.field),
      child: Text(
        text,
        style: TextStyle(fontSize: 13, height: 1.4, color: c.warnText),
      ),
    );
  }
}

class _PromoField extends StatelessWidget {
  final TextEditingController controller;
  final String? applied;
  final String? error;
  final VoidCallback onApply;

  const _PromoField({
    required this.controller,
    required this.applied,
    required this.error,
    required this.onApply,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.only(left: Gap.lg, right: 6),
          decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.pill),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    hintText: 'Промокод',
                    border: InputBorder.none,
                    isDense: true,
                  ),
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              PressScale(
                onTap: onApply,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: c.ink,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    'Применить',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: c.surface,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (applied != null)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm, left: Gap.xs),
            child: Text(
              'Промокод $applied применён',
              style: TextStyle(fontSize: 13, color: c.benefit),
            ),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm, left: Gap.xs),
            child: Text(
              error!,
              style: TextStyle(fontSize: 13, color: c.accent),
            ),
          ),
      ],
    );
  }
}

/// Тёмный блок списания баллов с ползунком.
///
/// Ползунок, а не «списать всё»: у старого приложения была одна кнопка на
/// весь баланс, и человек не мог оставить баллы на следующий заказ.
class _PointsBlock extends StatelessWidget {
  final int value;
  final int max;
  final int balance;
  final ValueChanged<double> onChanged;

  const _PointsBlock({
    required this.value,
    required this.max,
    required this.balance,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: c.ink, borderRadius: R.block),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Списать баллы',
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                  color: c.surface,
                ),
              ),
              Text(
                '$balance доступно',
                style: TextStyle(
                  fontSize: 12,
                  color: c.surface.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
          const SizedBox(height: Gap.md),
          AnimatedMoney(
            value,
            style: Theme.of(context).textTheme.displayLarge?.copyWith(
              fontSize: 28,
              color: c.benefit,
            ),
          ),
          SliderTheme(
            data: SliderThemeData(
              trackHeight: 4,
              activeTrackColor: c.benefit,
              inactiveTrackColor: c.surface.withValues(alpha: 0.2),
              thumbColor: c.benefit,
              overlayShape: SliderComponentShape.noOverlay,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 11),
            ),
            child: Slider(
              value: value.toDouble().clamp(0, max.toDouble()),
              max: max <= 0 ? 1 : max.toDouble(),
              divisions: max < 50 ? null : (max / 50).round(),
              onChanged: max <= 0 ? null : onChanged,
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '0',
                style: TextStyle(
                  fontSize: 11.5,
                  color: c.surface.withValues(alpha: 0.55),
                ),
              ),
              Text(
                '$max',
                style: TextStyle(
                  fontSize: 11.5,
                  color: c.surface.withValues(alpha: 0.55),
                ),
              ),
            ],
          ),
          const SizedBox(height: Gap.md),
          Row(
            children: [
              Expanded(
                child: _DarkButton(
                  label: 'Не списывать',
                  onTap: () => onChanged(0),
                ),
              ),
              const SizedBox(width: Gap.sm),
              Expanded(
                child: _DarkButton(
                  label: 'Максимум',
                  onTap: () => onChanged(max.toDouble()),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DarkButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _DarkButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PressScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: c.surface.withValues(alpha: 0.12),
          borderRadius: R.pill,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: c.surface,
          ),
        ),
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  final CartPreview preview;
  final int points;
  final String? promo;

  const _Totals({required this.preview, required this.points, this.promo});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    TextStyle line([Color? color]) => TextStyle(
      fontSize: 13,
      height: 1.7,
      fontWeight: FontWeight.w500,
      color: color ?? c.muted,
    );

    return Column(
      children: [
        _row('Товары', formatTenge(preview.subtotal), line(), line()),
        _row(
          'Доставка',
          preview.deliveryFee == 0
              ? 'бесплатно'
              : formatTenge(preview.deliveryFee),
          line(),
          line(),
        ),
        if (preview.promoDiscount > 0)
          _row(
            'Подарок по акции',
            formatTenge(preview.promoDiscount),
            line(c.benefit),
            line(c.benefit),
          ),
        if (points > 0)
          _row(
            'Баллы',
            '−${formatTenge(points)}',
            line(c.accent),
            line(c.accent),
          ),
      ],
    );
  }

  Widget _row(String label, String value, TextStyle l, TextStyle v) => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: [Text(label, style: l), Text(value, style: v)],
  );
}

class _Empty extends StatelessWidget {
  final bool embedded;
  const _Empty({required this.embedded});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Gap.blockWide),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                color: c.accentSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.shopping_bag_outlined,
                size: 34,
                color: c.accent,
              ),
            ),
            const SizedBox(height: Gap.block),
            Text(
              'Пока пусто',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: 20),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              'Можно повторить прошлый заказ — это быстрее всего',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
