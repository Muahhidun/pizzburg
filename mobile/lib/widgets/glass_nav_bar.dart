import 'dart:math' as math;
import 'dart:ui';

import 'liquid_glass.dart';

import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';

class NavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;

  const NavItem({required this.icon, IconData? activeIcon, required this.label})
    : activeIcon = activeIcon ?? icon;
}

/// Плавающий стеклянный таб-бар.
///
/// Не приклеен к нижнему краю, а висит над контентом капсулой: содержимое
/// просвечивает сквозь него и подсказывает, что список продолжается. Это
/// и есть смысл «стекла» — не эффект ради эффекта, а слой, который не
/// отрезает нижнюю часть экрана.
///
/// **Подсветка следует за пальцем.** Можно нажать на вкладку, не отпускать
/// и вести палец вдоль бара — капсула едет вместе с пальцем и растягивается
/// на полпути между вкладками, как капля. Вкладка выбирается там, где палец
/// отпустили. Без этого «стекло» остаётся картинкой: жест — единственное,
/// что делает материал живым, потому что он отзывается на руку, а не на
/// таймер.
///
/// Поэтому здесь `Listener`, а не `GestureDetector`: нужны сырые события
/// указателя. Обычный тап — это тот же жест, у которого нажатие и
/// отпускание произошли в одной точке, отдельной ветки он не требует.
///
/// Счётчиков на вкладках нет намеренно — в старом приложении они
/// превращали навигацию в табло (см. `docs/DESIGN_SYSTEM.md`).
class GlassNavBar extends StatefulWidget {
  final List<NavItem> items;
  final int index;
  final ValueChanged<int> onChanged;

  const GlassNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onChanged,
  });

  @override
  State<GlassNavBar> createState() => _GlassNavBarState();
}

class _GlassNavBarState extends State<GlassNavBar> {
  /// Положение пальца внутри бара; null — палец бара не касается
  double? _dragX;

  /// Вкладка под пальцем: пока палец ведут, подсвечивается именно она,
  /// а не выбранная. Иначе капсула уезжает, а иконки не отзываются.
  int _hoverIndex = 0;

  int get _activeIndex => _dragX != null ? _hoverIndex : widget.index;

  void _updateFrom(double dx, double width) {
    final slot = width / widget.items.length;
    final index = (dx ~/ slot).clamp(0, widget.items.length - 1);
    // Щелчок на каждой пересечённой границе — так это ощущается на iOS
    if (index != _hoverIndex || _dragX == null) Haptics.selection();
    setState(() {
      _dragX = dx.clamp(0.0, width);
      _hoverIndex = index;
    });
  }

  void _commit() {
    final index = _hoverIndex;
    setState(() => _dragX = null);
    if (index != widget.index) widget.onChanged(index);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        Gap.lg,
        0,
        Gap.lg,
        // На iPhone с домашней полоской хватает зазора над ней, без неё
        // бар иначе прилипает к самому краю экрана.
        math.max(MediaQuery.paddingOf(context).bottom + Gap.sm, Gap.lg),
      ),
      child: ClipRRect(
        borderRadius: R.pill,
        // Два слоя, а не один составной фильтр: размытие отвечает за
        // читаемость подписей, преломление — за то, чтобы материал читался
        // стеклом. Составить их в один ImageFilter нельзя, см. LiquidGlass.
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: LayoutBuilder(
            builder: (context, outer) => _Refracted(
              filter: LiquidGlass.filter(
                center: _lensCenter(outer.maxWidth),
                half: _lensHalf,
                aspect: outer.maxWidth / math.max(outer.maxHeight, 1),
                // Подобрано на симуляторе: на 0.09 преломления не видно
                // вовсе, на 0.30 фон заметно коробит.
                strength: _dragX != null ? 0.22 : 0.17,
              ),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: R.pill,
                  // Сверху стекло светлее, снизу темнее — так падает свет,
                  // а ровная заливка выдаёт плоскую плашку.
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      c.surface.withValues(alpha: 0.80),
                      c.surface.withValues(alpha: 0.60),
                    ],
                  ),
                  border: Border.all(
                    color: c.surface.withValues(alpha: 0.7),
                    width: 0.8,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: c.ink.withValues(alpha: 0.12),
                      blurRadius: 28,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.maxWidth;
                    final slot = width / widget.items.length;
                    final dragging = _dragX != null;

                    // Насколько капсула отошла от центра своей вкладки: на
                    // полпути между вкладками она растягивается, как капля.
                    final centerOf = (_activeIndex + 0.5) * slot;
                    final offCenter = dragging
                        ? ((_dragX! - centerOf).abs() / (slot / 2)).clamp(
                            0.0,
                            1.0,
                          )
                        : 0.0;
                    final pillWidth = slot * (1 + 0.14 * offCenter);

                    final pillLeft = dragging
                        ? (_dragX! - pillWidth / 2).clamp(
                            0.0,
                            width - pillWidth,
                          )
                        : slot * widget.index;

                    return Listener(
                      // opaque, а не deferToChild: сами вкладки для нажатий
                      // прозрачны, и без этого палец, попавший мимо капсулы,
                      // не доходил бы до бара вовсе — тап просто не срабатывал.
                      behavior: HitTestBehavior.opaque,
                      onPointerDown: (e) =>
                          _updateFrom(e.localPosition.dx, width),
                      onPointerMove: (e) =>
                          _updateFrom(e.localPosition.dx, width),
                      onPointerUp: (_) => _commit(),
                      onPointerCancel: (_) => setState(() => _dragX = null),
                      child: Stack(
                        children: [
                          AnimatedPositioned(
                            // Пока палец на баре — никакой анимации: капсула
                            // обязана быть ровно под пальцем, а не догонять его.
                            duration: dragging ? Duration.zero : Motion.base,
                            curve: Motion.benefit,
                            left: pillLeft,
                            top: 6,
                            bottom: 6,
                            width: dragging ? pillWidth : slot,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                              ),
                              child: _Pill(pressed: dragging),
                            ),
                          ),
                          Row(
                            children: [
                              for (var i = 0; i < widget.items.length; i++)
                                Expanded(
                                  child: _Tab(
                                    item: widget.items[i],
                                    active: _activeIndex == i,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Центр линзы в долях бара. Пока палец ведут — под пальцем, иначе на
  /// выбранной вкладке.
  Offset _lensCenter(double width) {
    final slot = 1 / widget.items.length;
    final x = _dragX != null
        ? (_dragX! / math.max(width, 1)).clamp(slot / 2, 1 - slot / 2)
        : (widget.index + 0.5) * slot;
    return Offset(x.toDouble(), 0.5);
  }

  /// Полуразмеры линзы в долях бара: по ширине — вкладка, по высоте —
  /// почти весь бар, с полем под кромку.
  Size get _lensHalf => Size(0.46 / widget.items.length, 0.40);
}

/// Слой преломления. Без шейдера (Skia, веб) просто пропускает ребёнка
/// дальше: стекло — украшение, а не условие работы бара.
class _Refracted extends StatelessWidget {
  final ImageFilter? filter;
  final Widget child;

  const _Refracted({required this.filter, required this.child});

  @override
  Widget build(BuildContext context) {
    final f = filter;
    if (f == null) return child;
    return BackdropFilter(filter: f, child: child);
  }
}

/// Сама «капля»: тоже стекло, а не заливка — со светом сверху и контуром
class _Pill extends StatelessWidget {
  final bool pressed;

  const _Pill({required this.pressed});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AnimatedContainer(
      duration: Motion.fast,
      curve: Motion.change,
      decoration: BoxDecoration(
        borderRadius: R.pill,
        // Преломление видно только там, где под стеклом есть что
        // преломлять. Над белым списком физика не поможет, поэтому форму
        // капли держат свет и кромка: блик сверху-слева, тень снизу-справа
        // и светлый контур. Так она читается стеклянной на любом фоне.
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            c.surface.withValues(alpha: pressed ? 0.72 : 0.55),
            c.accent.withValues(alpha: pressed ? 0.26 : 0.18),
            c.accent.withValues(alpha: pressed ? 0.12 : 0.08),
          ],
          stops: const [0.0, 0.55, 1.0],
        ),
        border: Border.all(
          color: c.surface.withValues(alpha: pressed ? 0.95 : 0.8),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: c.ink.withValues(alpha: pressed ? 0.14 : 0.10),
            blurRadius: pressed ? 14 : 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final NavItem item;
  final bool active;

  const _Tab({required this.item, required this.active});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = active ? c.accent : c.muted;

    // Нажатия ловит Listener на баре целиком: своих обработчиков у вкладки
    // нет, иначе они перехватывали бы ведение пальцем.
    return IgnorePointer(
      child: SizedBox(
        height: Gap.navBar,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedScale(
              scale: active ? 1.1 : 1,
              duration: Motion.base,
              curve: Motion.benefit,
              child: Icon(
                active ? item.activeIcon : item.icon,
                size: 21,
                color: color,
              ),
            ),
            const SizedBox(height: 3),
            AnimatedDefaultTextStyle(
              duration: Motion.base,
              style: TextStyle(
                fontFamily: 'Golos Text',
                fontSize: 11,
                height: 1,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
              // Пять вкладок вместо четырёх: «Избранное» — самое длинное
              // слово, и на узком экране его нужно ужать, а не обрезать.
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(item.label, maxLines: 1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
