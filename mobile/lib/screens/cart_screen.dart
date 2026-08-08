import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../state/cart.dart';
import 'checkout_screen.dart';

/// Корзина. Суммы и подарки по акциям считает сервер (/cart/preview) —
/// клиент ничего не выдумывает, поэтому расчёт всегда совпадёт с заказом.
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  CartPreview? _preview;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final cart = context.read<Cart>();
    if (cart.isEmpty) {
      setState(() {
        _preview = null;
        _loading = false;
      });
      return;
    }
    setState(() => _loading = true);
    try {
      final preview = await context.read<ApiClient>().previewCart(
        cart.toApiItems(),
      );
      if (mounted) {
        setState(() {
          _preview = preview;
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<Cart>();

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Корзина',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        backgroundColor: Colors.white,
        actions: [
          if (!cart.isEmpty)
            TextButton(
              onPressed: () {
                cart.clear();
                _refresh();
              },
              child: const Text('Очистить'),
            ),
        ],
      ),
      body: cart.isEmpty
          ? const Center(
              child: Text(
                'Корзина пуста',
                style: TextStyle(fontSize: 16, color: Colors.black54),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                ...cart.lines.map(
                  (line) => _CartLineTile(line: line, onChanged: _refresh),
                ),
                if (_preview != null && _preview!.gifts.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ..._preview!.gifts.map((g) => _GiftTile(gift: g)),
                ],
                const SizedBox(height: 16),
                if (_loading)
                  const Center(child: CircularProgressIndicator())
                else if (_error != null)
                  Text(_error!, style: const TextStyle(color: Colors.red))
                else if (_preview != null)
                  _Totals(preview: _preview!),
              ],
            ),
      bottomNavigationBar: cart.isEmpty || _preview == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: SizedBox(
                  height: 56,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.black,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => CheckoutScreen(preview: _preview!),
                      ),
                    ),
                    child: Text(
                      'Оформить · ${formatTenge(_preview!.subtotal)}',
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
}

class _CartLineTile extends StatelessWidget {
  final CartLine line;
  final VoidCallback onChanged;

  const _CartLineTile({required this.line, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final cart = context.read<Cart>();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.product.name,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (line.modifiers.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      line.modifiers.map((m) => m.name).join(' · '),
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.black54,
                      ),
                    ),
                  ),
                const SizedBox(height: 4),
                Text(
                  formatTenge(line.total),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          _QtyStepper(
            qty: line.qty,
            onMinus: () {
              cart.decrement(line);
              onChanged();
            },
            onPlus: () {
              cart.increment(line);
              onChanged();
            },
          ),
        ],
      ),
    );
  }
}

class _QtyStepper extends StatelessWidget {
  final int qty;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  const _QtyStepper({
    required this.qty,
    required this.onMinus,
    required this.onPlus,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF1F1F1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onMinus,
            icon: const Icon(Icons.remove, size: 18),
            visualDensity: VisualDensity.compact,
          ),
          Text(
            '$qty',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
          IconButton(
            onPressed: onPlus,
            icon: const Icon(Icons.add, size: 18),
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

/// Подарок по акции — появляется сам, менять нельзя
class _GiftTile extends StatelessWidget {
  final CartGift gift;
  const _GiftTile({required this.gift});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F5E9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFA5D6A7)),
      ),
      child: Row(
        children: [
          const Icon(Icons.card_giftcard, color: Color(0xFF2E7D32)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${gift.name} × ${gift.qty}',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  'Подарок · ${gift.promotion}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF2E7D32),
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text(
                '0 ₸',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF2E7D32),
                ),
              ),
              Text(
                formatTenge(gift.fullPrice * gift.qty),
                style: const TextStyle(
                  fontSize: 12,
                  color: Colors.black38,
                  decoration: TextDecoration.lineThrough,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  final CartPreview preview;
  const _Totals({required this.preview});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          _row('Товары', formatTenge(preview.subtotal)),
          if (preview.promoDiscount > 0)
            _row(
              'Выгода по акции',
              formatTenge(preview.promoDiscount),
              color: const Color(0xFF2E7D32),
            ),
          if (!preview.deliveryAvailable)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Доставка от ${formatTenge(preview.minOrder)} — сейчас доступен самовывоз',
                style: const TextStyle(fontSize: 13, color: Colors.orange),
              ),
            )
          else if (preview.deliveryFee > 0)
            _row('Доставка', formatTenge(preview.deliveryFee))
          else
            _row('Доставка', 'бесплатно', color: const Color(0xFF2E7D32)),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {Color? color}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: color ?? Colors.black54)),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: color ?? Colors.black,
          ),
        ),
      ],
    ),
  );
}
