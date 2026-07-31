import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/models.dart';
import '../state/cart.dart';
import '../widgets/product_card.dart';

/// Карточка товара с выбором в наборах модификаторов
/// («Донер Комбо», «Напиток к сету»).
class ProductScreen extends StatefulWidget {
  final Product product;
  const ProductScreen({super.key, required this.product});

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  /// groupId → выбранная опция
  final Map<String, ModifierOption> _selected = {};

  @override
  void initState() {
    super.initState();
    // предвыбираем первую опцию в обязательных группах
    for (final g in widget.product.modifierGroups) {
      if (g.min > 0 && g.options.isNotEmpty) _selected[g.id] = g.options.first;
    }
  }

  bool get _isComplete => widget.product.modifierGroups
      .where((g) => g.min > 0)
      .every((g) => _selected.containsKey(g.id));

  int get _total =>
      widget.product.price +
      _selected.values.fold(0, (sum, o) => sum + o.price);

  @override
  Widget build(BuildContext context) {
    final p = widget.product;

    return Scaffold(
      backgroundColor: Colors.white,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 280,
            pinned: true,
            backgroundColor: Colors.white,
            leading: Padding(
              padding: const EdgeInsets.all(8),
              child: CircleAvatar(
                backgroundColor: Colors.white70,
                child: IconButton(
                  icon: const Icon(Icons.close, color: Colors.black),
                  onPressed: () => Navigator.pop(context),
                ),
              ),
            ),
            flexibleSpace:
                FlexibleSpaceBar(background: ProductImage(url: p.photoUrl)),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(p.name,
                      style: const TextStyle(
                          fontSize: 26, fontWeight: FontWeight.w800)),
                  if (p.description.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(p.description,
                        style: const TextStyle(
                            fontSize: 15, color: Colors.black54, height: 1.4)),
                  ],
                  const SizedBox(height: 20),
                  for (final group in p.modifierGroups) ...[
                    Text(group.name,
                        style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w700)),
                    if (group.min > 0)
                      const Text('Обязательный выбор',
                          style:
                              TextStyle(fontSize: 13, color: Colors.black45)),
                    const SizedBox(height: 8),
                    ...group.options.map((option) {
                      final selected = _selected[group.id]?.id == option.id;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: GestureDetector(
                          onTap: () =>
                              setState(() => _selected[group.id] = option),
                          child: Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: selected
                                  ? Colors.black.withValues(alpha: 0.04)
                                  : Colors.white,
                              border: Border.all(
                                color: selected
                                    ? Colors.black
                                    : const Color(0xFFE0E0E0),
                                width: selected ? 1.5 : 1,
                              ),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  selected
                                      ? Icons.radio_button_checked
                                      : Icons.radio_button_unchecked,
                                  size: 20,
                                  color:
                                      selected ? Colors.black : Colors.black26,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(option.name,
                                      style: const TextStyle(fontSize: 15)),
                                ),
                                if (option.price > 0)
                                  Text('+${formatTenge(option.price)}',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600)),
                              ],
                            ),
                          ),
                        ),
                      );
                    }),
                    const SizedBox(height: 16),
                  ],
                ],
              ),
            ),
          ),
        ],
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
              onPressed: _isComplete
                  ? () {
                      context.read<Cart>().add(p,
                          modifiers: _selected.values.toList());
                      Navigator.pop(context);
                    }
                  : null,
              child: Text(
                'В корзину · ${formatTenge(_total)}',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
