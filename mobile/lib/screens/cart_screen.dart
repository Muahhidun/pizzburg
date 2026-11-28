import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../services/analytics.dart';
import '../state/auth.dart';
import '../state/cart.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import '../widgets/motion.dart';
import 'catalog_parts.dart' show ModeSwitch;
import 'checkout_screen.dart';
import '../i18n/strings.dart';
import '../widgets/app_route.dart';

/// Корзина по прототипу «Сигнал».
///
/// Первым — «Доставка / Самовывоз» (Дом, 28.11.2026): от выбора зависит
/// сумма, и решать его надо там, где человек её видит. Дальше порядок не
/// случайный: сначала состав, потом выгода (подарок, промокод, баллы), в
/// конце итог. Человек сначала проверяет, что заказал, и только потом
/// занимается экономией.
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
  final _scroll = ScrollController();

  /// Нажали «Оформить», не выбрав способ получения: подсвечиваем выбор
  bool _nudge = false;

  /// Слепок состава, по которому уже посчитано превью.
  ///
  /// Во вкладке экран создаётся один раз — при пустой корзине — и больше
  /// не пересоздаётся. Без сравнения состава превью так и осталось бы
  /// пустым, а вместе с ним пропала бы кнопка «Оформить».
  String? _previewedFor;

  @override
  void initState() {
    super.initState();
    OrderMode.value.addListener(_onMode);
    _refresh();
  }

  @override
  void dispose() {
    OrderMode.value.removeListener(_onMode);
    _promo.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onMode() {
    if (mounted) setState(() => _nudge = false);
  }

  /// Способ получения с поправкой на заведение: доставки сейчас нет —
  /// значит самовывоз, а сохранённый выбор не трогаем до следующего раза.
  String? _modeFor(CartPreview? p) =>
      p != null && !p.deliveryAvailable ? 'PICKUP' : OrderMode.value.value;

  Future<void> _askMode() async {
    await Haptics.warning();
    if (!mounted) return;
    setState(() => _nudge = true);
    if (_scroll.hasClients) {
      _scroll.animateTo(0, duration: Motion.base, curve: Motion.change);
    }
  }

  Future<void> _refresh() async {
    final cart = context.read<Cart>();
    if (cart.isEmpty) {
      setState(() {
        _preview = null;
        _previewedFor = null;
        _loading = false;
        _points = 0;
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
        // Показ допродаж пишем здесь, вместе с пересчётом: build
        // вызывается по многу раз, и событие в нём превратилось бы в
        // поток одинаковых записей.
        if (preview.upsell.isNotEmpty) {
          context.read<Analytics>().log(Ev.upsellShown, {
            'productIds': preview.upsell.map((o) => o.productId).toList(),
          });
        }
        // Состав изменился — списание сбрасываем: иначе оно может
        // превысить новую сумму заказа.
        //
        // А если акция запрещает баллы, обнуляем совсем: значение,
        // оставшееся от прошлой корзины, гасило кнопку оформления
        // отказом сервера, и починить его на этом экране было нечем —
        // ползунок к тому моменту уже неактивен.
        _points = preview.pointsAllowed
            ? _points.clamp(0, _maxPoints(preview))
            : 0;
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

  /// Сколько баллов можно списать: меньшее из баланса и потолка.
  ///
  /// Потолок считает сервер — это настройка заведения, и приложение не
  /// должно знать её формулу. Свой предел по стоимости товаров остаётся
  /// на случай старого сервера, который потолка ещё не отдаёт.
  int _maxPoints(CartPreview preview) {
    final balance = context.read<AuthState>().pointsBalance;
    final cap = preview.maxPointsSpend > 0
        ? preview.maxPointsSpend
        : preview.subtotal;
    return balance < cap ? balance : cap;
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
          _promoError = S.noSuchPromo;
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

    // Пустая корзина — конец прошлого заказа: он либо оформлен, либо
    // разобран по одной позиции. Ползунок баллов начинает следующий заказ
    // с нуля. Экран живёт в IndexedStack и не пересоздаётся, поэтому
    // значение доживало до новой корзины и списывало баллы молча — человек
    // видел готовую сумму и не знал, что за неё уже заплатил накоплениями.
    if (cart.isEmpty && _points != 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && context.read<Cart>().isEmpty) {
          setState(() => _points = 0);
        }
      });
    }

    // Состав изменился на другом экране — пересчитываем после кадра:
    // setState во время build запрещён.
    if (!cart.isEmpty && !_loading && _previewedFor != _signatureOf(cart)) {
      _previewedFor = _signatureOf(cart);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _refresh();
      });
    }

    return Scaffold(
      backgroundColor: c.page,
      body: SafeArea(
        bottom: false,
        child: cart.isEmpty
            ? (widget.embedded && WideLayout.of(context)
                  ? const _PanelEmpty()
                  : _Empty(embedded: widget.embedded))
            : ListView(
                controller: _scroll,
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
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
                        S.cart,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: Gap.lg),
                  _ModeBlock(
                    mode: _modeFor(preview),
                    preview: preview,
                    nudge: _nudge,
                  ),
                  const SizedBox(height: Gap.md),

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
                        text: S.addMoreForGift(
                          formatTenge(preview.nextGift!.missing),
                          preview.nextGift!.giftName.toLowerCase(),
                        ),
                      ),

                    // Допродажи идут после состава и подарков, но до
                    // выгоды: сначала человек проверяет, что заказал,
                    // потом ему предлагают дополнить — и только потом он
                    // занимается промокодом и баллами. Поставить блок
                    // ниже значило бы вклиниться в подсчёт денег.
                    if (preview.upsell.isNotEmpty)
                      _UpsellStrip(
                        offers: preview.upsell,
                        onAdd: (offer) {
                          Haptics.tap();
                          // Без «показали» число «взяли» не значит
                          // ничего: пять добавлений — это успех или
                          // провал, смотря сколько раз предложили
                          context.read<Analytics>().log(Ev.upsellAdded, {
                            'productId': offer.productId,
                            'name': offer.name,
                          });
                          cart.add(offer.toProduct());
                          _refresh();
                        },
                      ),

                    const SizedBox(height: Gap.lg),
                    _PromoField(
                      controller: _promo,
                      applied: _promoApplied,
                      error: _promoError,
                      onApply: _applyPromo,
                    ),

                    if (context.watch<AuthState>().isAuthenticated) ...[
                      const SizedBox(height: Gap.md),
                      PointsRow(
                        value: _points,
                        max: _maxPoints(preview),
                        balance: context.watch<AuthState>().pointsBalance,
                        // Акция и баллы несовместимы. Раньше об этом
                        // сообщал сервер на оформлении — то есть через два
                        // экрана после того, как человек выставил ползунок,
                        // и вернуться к нему было уже некуда. Гасим строку
                        // там, где она стоит, и объясняем на месте.
                        blockedByPromo: !preview.pointsAllowed,
                        onSlide: (v) {
                          _pointsHaptic.onValue(v);
                          setState(() => _points = v.round());
                        },
                        onToggle: (v) {
                          Haptics.selection();
                          setState(() => _points = v);
                        },
                      ),
                    ],

                    const SizedBox(height: Gap.blockWide),
                    _Totals(
                      preview: preview,
                      points: _points,
                      promo: _promoApplied,
                      delivery: _modeFor(preview) == 'DELIVERY',
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
                  widget.embedded && !WideLayout.of(context)
                      ? Gap.navBar + Gap.lg
                      : Gap.md,
                ),
                child: _modeFor(preview) == null
                    ? PressScale(
                        onTap: _askMode,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 22,
                            vertical: 21,
                          ),
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: c.panel,
                            borderRadius: R.pill,
                          ),
                          child: Text(
                            S.chooseHowToGet,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                              color: c.surface,
                            ),
                          ),
                        ),
                      )
                    : PressScale(
                        onTap: () async {
                          await Navigator.push(
                            context,
                            AppRoute(
                              builder: (_) => CheckoutScreen(
                                preview: preview,
                                initialPoints: _points,
                                initialType: _modeFor(preview)!,
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
                                  S.checkout,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    fontWeight: FontWeight.w600,
                                    color: c.onSurface,
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
      p.subtotal +
      (_modeFor(p) == 'DELIVERY' && p.deliveryAvailable ? p.deliveryFee : 0) -
      _points.clamp(0, p.subtotal);
}

/// «Доставка / Самовывоз» наверху корзины и строка под ним: сколько стоит
/// доставка, откуда забирать или почему доставки нет.
class _ModeBlock extends StatelessWidget {
  final String? mode;
  final CartPreview? preview;
  final bool nudge;

  const _ModeBlock({
    required this.mode,
    required this.preview,
    required this.nudge,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final p = preview;
    final closedHint = p == null ? null : deliveryHint(p);

    final String? note;
    Color color = c.muted;
    if (closedHint != null) {
      note = closedHint;
      color = c.warnText;
    } else if (mode == null) {
      note = S.chooseHowToGetHint;
      color = nudge ? c.warnText : c.muted;
    } else if (mode == 'PICKUP') {
      note = S.pickupHint(S.pickupPointShort);
    } else if (p != null) {
      note = p.deliveryFee == 0
          ? S.deliveryFreeHint
          : S.deliveryFeeHint(formatTenge(p.deliveryFee));
    } else {
      note = null;
    }

    return AnimatedContainer(
      duration: Motion.base,
      padding: EdgeInsets.all(nudge && mode == null ? Gap.md : 0),
      decoration: BoxDecoration(
        color: nudge && mode == null ? c.warnSoft : Colors.transparent,
        borderRadius: R.block,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ModeSwitch(
            mode: mode ?? '',
            deliveryAvailable: p?.deliveryAvailable ?? true,
            onChanged: (m) {
              Haptics.selection();
              OrderMode.set(m);
            },
          ),
          if (note != null) ...[
            const SizedBox(height: Gap.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Gap.xs),
              child: Text(
                note,
                style: TextStyle(fontSize: 12.5, height: 1.4, color: color),
              ),
            ),
          ],
        ],
      ),
    );
  }
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
              child:
                  line.product.photoUrl == null ||
                      line.product.photoUrl!.isEmpty
                  ? ColoredBox(color: c.fillSoft)
                  : Image.network(
                      // В браузере — на холсте Flutter, <img> только для серверов
                      // без CORS (Poster): см. _Photo в catalog_parts.dart.
                      webHtmlElementStrategy: WebHtmlElementStrategy.fallback,

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
            child: Icon(Icons.card_giftcard, size: 22, color: c.onBenefit),
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
                    color: c.accent,
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
              S.gift,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: c.onBenefit,
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

/// «Добавить к заказу»: горизонтальная лента предложений.
///
/// Лента, а не список: блок не должен отодвигать итог вниз — человек
/// пришёл в корзину оформлять, а не читать ещё одно меню. Что именно
/// предлагать, решает сервер; приложение не знает правил подбора.
class _UpsellStrip extends StatelessWidget {
  final List<UpsellOffer> offers;
  final ValueChanged<UpsellOffer> onAdd;

  const _UpsellStrip({required this.offers, required this.onAdd});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: Gap.lg),
        Text(
          S.addToOrder,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontSize: 15),
        ),
        const SizedBox(height: Gap.md),
        SizedBox(
          height: 168,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.zero,
            itemCount: offers.length,
            separatorBuilder: (_, _) => const SizedBox(width: Gap.md),
            itemBuilder: (context, i) {
              final offer = offers[i];
              return SizedBox(
                width: 116,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: R.thumb,
                      child: SizedBox(
                        width: 116,
                        height: 92,
                        child: offer.photoUrl == null
                            ? ColoredBox(color: c.fillSoft)
                            : Image.network(
                                // В браузере — на холсте Flutter, <img> только для серверов
                                // без CORS (Poster): см. _Photo в catalog_parts.dart.
                                webHtmlElementStrategy:
                                    WebHtmlElementStrategy.fallback,

                                offer.photoUrl!,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) =>
                                    ColoredBox(color: c.fillSoft),
                              ),
                      ),
                    ),
                    const SizedBox(height: Gap.sm),
                    Text(
                      offer.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, height: 1.25),
                    ),
                    const Spacer(),
                    PressScale(
                      onTap: () => onAdd(offer),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: c.accentSoft,
                          borderRadius: R.pill,
                        ),
                        child: Text(
                          '+ ${formatTenge(offer.price)}',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: c.accent,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
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
                  decoration: InputDecoration(
                    hintText: S.promoCode,
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
                    color: c.panel,
                    borderRadius: R.pill,
                  ),
                  child: Text(
                    S.apply,
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
              S.promoApplied(applied!),
              style: TextStyle(fontSize: 13, color: c.accent),
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

/// Списание баллов — одной светлой строкой с переключателем.
///
/// Раньше это был тёмный блок со слайдером на четверть экрана: он спорил с
/// кнопкой «Оформить» и выглядел главным на экране (Дом, 28.11.2026).
/// Почти все списывают всё или ничего, поэтому главное действие —
/// переключатель на максимум. Ползунок остался для тех, кто хочет оставить
/// часть баллов на потом: он раскрывается по «Списать часть».
@visibleForTesting
class PointsRow extends StatefulWidget {
  final int value;
  final int max;
  final int balance;
  final ValueChanged<double> onSlide;
  final ValueChanged<int> onToggle;

  /// Сработала акция: списание баллов недоступно
  final bool blockedByPromo;

  const PointsRow({
    super.key,
    required this.value,
    required this.max,
    required this.balance,
    required this.onSlide,
    required this.onToggle,
    this.blockedByPromo = false,
  });

  @override
  State<PointsRow> createState() => _PointsRowState();
}

class _PointsRowState extends State<PointsRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final w = widget;
    final can = !w.blockedByPromo && w.max > 0;
    final on = can && w.value > 0;

    final String subtitle;
    Color subColor = c.muted;
    if (w.blockedByPromo) {
      subtitle = S.pointsBlockedShort;
    } else if (w.max <= 0) {
      subtitle = S.pointsNoneYet;
    } else if (on) {
      subtitle = S.pointsWillSpend(formatTenge(w.value));
      subColor = c.accent;
    } else {
      subtitle = S.pointsCanSpend(formatTenge(w.max));
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.md, Gap.md),
      decoration: BoxDecoration(color: c.fillSoft, borderRadius: R.field),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      S.pointsBalance(
                        formatTenge(w.balance, withCurrency: false),
                      ),
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: can ? c.ink : c.muted,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.3,
                        color: subColor,
                      ),
                    ),
                  ],
                ),
              ),
              if (can && w.max >= 100)
                PressScale(
                  onTap: () => setState(() => _open = !_open),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Gap.sm,
                      vertical: Gap.sm,
                    ),
                    child: Text(
                      _open ? S.pointsHidePart : S.pointsChoosePart,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: c.accent,
                      ),
                    ),
                  ),
                ),
              Switch.adaptive(
                value: on,
                activeTrackColor: c.benefit,
                onChanged: can ? (v) => w.onToggle(v ? w.max : 0) : null,
              ),
            ],
          ),
          if (_open && can) ...[
            SliderTheme(
              data: SliderThemeData(
                trackHeight: 3,
                activeTrackColor: c.benefit,
                inactiveTrackColor: c.border,
                thumbColor: c.benefit,
                overlayShape: SliderComponentShape.noOverlay,
                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 9),
              ),
              child: Padding(
                padding: const EdgeInsets.only(top: Gap.md, right: Gap.sm),
                child: Slider(
                  value: w.value.toDouble().clamp(0, w.max.toDouble()),
                  max: w.max.toDouble(),
                  divisions: w.max < 50 ? null : (w.max / 50).round(),
                  onChanged: w.onSlide,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: Gap.xs, right: Gap.sm),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('0', style: TextStyle(fontSize: 11.5, color: c.muted)),
                  Text(
                    formatTenge(w.max, withCurrency: false),
                    style: TextStyle(fontSize: 11.5, color: c.muted),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  final CartPreview preview;
  final int points;
  final String? promo;

  /// Выбрана доставка. Иначе строки доставки нет: на самовывозе она не
  /// нужна, а пока способ не выбран — сумма без неё (почему, сказано под
  /// переключателем наверху).
  final bool delivery;

  const _Totals({
    required this.preview,
    required this.points,
    required this.delivery,
    this.promo,
  });

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
        _row(S.goods, formatTenge(preview.subtotal), line(), line()),
        if (delivery)
          _row(
            S.delivery,
            // Доставить такую корзину нельзя — значит и цены доставки нет.
            // Раньше тут стояли 600 ₸ и итог с ними, хотя оформить можно
            // было только самовывоз, и человек не понимал почему.
            _belowMin(preview)
                ? S.deliveryFrom(formatTenge(preview.minOrder))
                : !preview.deliveryAvailable
                ? S.deliveryOff
                : preview.deliveryFee == 0
                ? S.free
                : formatTenge(preview.deliveryFee),
            line(),
            line(),
          ),
        if (preview.promoDiscount > 0)
          _row(
            S.promoGift,
            formatTenge(preview.promoDiscount),
            line(c.accent),
            line(c.accent),
          ),
        if (points > 0)
          _row(
            S.points,
            '−${formatTenge(points)}',
            line(c.accent),
            line(c.accent),
          ),
      ],
    );
  }

  Widget _row(String label, String value, TextStyle l, TextStyle v) => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: [
      Text(label, style: l),
      Text(value, style: v),
    ],
  );
}

/// Сумма меньше минимальной для доставки (при открытой доставке)
bool _belowMin(CartPreview p) =>
    !p.deliveryAvailable &&
    p.availability.deliveryAvailable &&
    p.minOrder > 0 &&
    p.subtotal < p.minOrder;

/// Почему доставки нет — одной строкой под итогом, или null
String? deliveryHint(CartPreview p) {
  if (p.deliveryAvailable) return null;
  if (_belowMin(p)) {
    return S.deliveryMinHint(
      formatTenge(p.minOrder),
      formatTenge(p.minOrder - p.subtotal),
    );
  }
  return S.deliveryClosedHint;
}

/// Пустая корзина в панели справа на компьютере.
///
/// Без заголовка панель читалась как пустое место с картинкой: что это
/// корзина, становилось ясно, только когда туда что-то падало. Поэтому
/// заголовок стоит всегда, а подсказка говорит, как её наполнить, —
/// повтор прошлого заказа здесь не к месту: меню и так рядом.
class _PanelEmpty extends StatelessWidget {
  const _PanelEmpty();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Gap.screen, Gap.lg, Gap.screen, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(S.cart, style: Theme.of(context).textTheme.headlineMedium),
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: c.accentSoft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.shopping_bag_outlined,
                      size: 28,
                      color: c.accent,
                    ),
                  ),
                  const SizedBox(height: Gap.lg),
                  Text(
                    S.cartEmpty,
                    style: Theme.of(
                      context,
                    ).textTheme.titleLarge?.copyWith(fontSize: 18),
                  ),
                  const SizedBox(height: Gap.sm),
                  Text(
                    S.cartPanelEmpty,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
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
              S.cartEmpty,
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: 20),
            ),
            const SizedBox(height: Gap.sm),
            Text(
              S.cartEmptyHint,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
