import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:liquid_glass_renderer/liquid_glass_renderer.dart';
import '../theme/app_theme.dart';
import '../theme/tokens.dart';
import '../utils/haptics.dart';
import 'motion.dart';

/// Сборочный флаг для подбора оптики линзы: держит стекло на экране без
/// пальца. Включается только руками: --dart-define=LENS_DEBUG=true
const _debugLens = bool.fromEnvironment('LENS_DEBUG');

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

  /// Вкладка корзины: она одна умеет расширяться.
  final int cartIndex;

  /// Сумма и количество в корзине. Пока корзина пуста, вкладка выглядит как
  /// все прочие; с первым товаром её слот разъезжается и показывает сумму.
  /// Отдельной плавающей плашки над баром нет намеренно: две панели внизу
  /// перекрывали друг друга и спорили за одно и то же действие.
  final int cartTotal;
  final int cartCount;

  /// Метка слота корзины: по ней анимация добавления находит, куда лететь.
  final GlobalKey? cartSlotKey;

  const GlassNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onChanged,
    required this.cartIndex,
    this.cartTotal = 0,
    this.cartCount = 0,
    this.cartSlotKey,
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

  /// Линза остаётся в дереве, пока догорает её фейд после отпускания
  bool _lensShown = false;

  int get _activeIndex => _dragX != null ? _hoverIndex : widget.index;

  /// Ширины и левые края слотов текущего кадра. Слоты неравные: корзина с
  /// товаром шире прочих, — поэтому вся геометрия бара считается по этим
  /// массивам, а не делением ширины на число вкладок.
  List<double> _sizes = const [];
  List<double> _lefts = const [];

  /// Насколько корзина шире обычной вкладки в раскрытом состоянии
  static const double _cartGrowth = 1.15;

  void _measureSlots(double width, double expand) {
    final n = widget.items.length;
    final extra = _cartGrowth * expand;
    final units = n + extra;
    _sizes = [
      for (var i = 0; i < n; i++)
        width * ((i == widget.cartIndex ? 1 + extra : 1) / units),
    ];
    var x = 0.0;
    _lefts = [
      for (final w in _sizes)
        (() {
          final l = x;
          x += w;
          return l;
        })(),
    ];
  }

  int _indexAt(double dx) {
    for (var i = 0; i < _sizes.length; i++) {
      if (dx < _lefts[i] + _sizes[i]) return i;
    }
    return _sizes.length - 1;
  }

  void _updateFrom(double dx, double width) {
    final index = _indexAt(dx.clamp(0.0, width));
    // Щелчок на каждой пересечённой границе — так это ощущается на iOS
    if (index != _hoverIndex || _dragX == null) Haptics.selection();
    setState(() {
      _dragX = dx.clamp(0.0, width);
      _hoverIndex = index;
      _lensShown = true;
    });
  }

  void _commit() {
    final index = _hoverIndex;
    setState(() => _dragX = null);
    if (index != widget.index) widget.onChanged(index);
  }

  /// Насколько линза выступает за бар по вертикали: кромка стекла должна
  /// гнуть и сам край панели, как в системном баре iOS 26.
  static const double _lensOverhang = 9;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        Gap.lg,
        0,
        Gap.lg,
        // На iPhone с домашней полоской хватает зазора над ней, без неё
        // бар иначе прилипает к самому краю экрана.
        math.max(MediaQuery.paddingOf(context).bottom + Gap.sm, Gap.lg),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          return TweenAnimationBuilder<double>(
            tween: Tween(end: widget.cartCount > 0 ? 1.0 : 0.0),
            duration: Motion.base,
            curve: Motion.benefit,
            builder: (context, expand, _) {
              return _buildBar(context, width, expand);
            },
          );
        },
      ),
    );
  }

  Widget _buildBar(BuildContext context, double width, double expand) {
    final c = context.colors;
    _measureSlots(width, expand);

    // Ширина обычной вкладки без раскрытия: по ней задаётся линза, чтобы её
    // размер не менялся вместе с корзиной (у Flutter утечка при анимации
    // размеров шейдерных фигур, flutter#138627 — двигать позицию безопасно).
    final uniform = width / widget.items.length;

    final dragging = _dragX != null || _debugLens;
    final activeCenter = _lefts[_activeIndex] + _sizes[_activeIndex] / 2;
    final dragX = _dragX ?? activeCenter;

    // Насколько капсула отошла от центра своей вкладки: на полпути
    // между вкладками она растягивается, как капля.
    final offCenter = dragging
        ? ((dragX - activeCenter).abs() / (_sizes[_activeIndex] / 2)).clamp(
            0.0,
            1.0,
          )
        : 0.0;
    final pillWidth = _sizes[_activeIndex] * (1 + 0.14 * offCenter);
    final pillLeft = dragging
        ? (dragX - pillWidth / 2).clamp(0.0, width - pillWidth)
        : _lefts[widget.index];

    // Тот же признак, которым гейтится сам пакет: линза требует
    // Impeller, на Skia и в вебе остаётся цветная капсула.
    final lensReady = ImageFilter.isShaderFilterSupported;
    final lensHeight = Gap.navBar + _lensOverhang * 2;
    final lensWidth = uniform * 1.5;
    final lensLeft = ((dragging ? dragX : activeCenter) - lensWidth / 2).clamp(
      -6.0,
      width - lensWidth + 6,
    );

    // Раскрытая корзина рисует свою акцентную капсулу — нейтральная плашка
    // под ней превратилась бы во вторую подложку.
    final cartOwnsPill = widget.index == widget.cartIndex && expand > 0.5;
    // Пока стеклянная линза на экране, перекраску вкладок делает она:
    // базовый ряд весь приглушён, акцент появляется только сквозь
    // маску — ровно настолько, насколько линза накрыла иконку.
    final lensDrag = dragging && lensReady;

    return Listener(
      // opaque, а не deferToChild: вкладки для нажатий прозрачны,
      // и без этого палец, попавший мимо капсулы, не доходил бы до
      // бара вовсе — тап просто не срабатывал.
      behavior: HitTestBehavior.opaque,
      onPointerDown: (e) => _updateFrom(e.localPosition.dx, width),
      onPointerMove: (e) => _updateFrom(e.localPosition.dx, width),
      onPointerUp: (_) => _commit(),
      onPointerCancel: (_) => setState(() => _dragX = null),
      // Линза выступает за бар — без Clip.none её бы обрезало
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Сама панель
          ClipRRect(
            borderRadius: R.pill,
            child: BackdropFilter(
              // Размытие отвечает за читаемость подписей поверх
              // проезжающего под баром списка.
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: R.pill,
                  // Сверху стекло светлее, снизу темнее — так падает
                  // свет, а ровная заливка выдаёт плоскую плашку.
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    // Не чисто белые: на белой странице белая панель
                    // сливается с фоном, и линзе не на чем читаться.
                    // Лёгкий серый — как системные панели iOS в
                    // светлой теме.
                    colors: [
                      Color.lerp(
                        c.surface,
                        c.ink,
                        0.045,
                      )!.withValues(alpha: 0.80),
                      Color.lerp(
                        c.surface,
                        c.ink,
                        0.07,
                      )!.withValues(alpha: 0.62),
                    ],
                  ),
                  border: Border.all(
                    color: c.ink.withValues(alpha: 0.05),
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
                child: SizedBox(
                  width: double.infinity,
                  height: Gap.navBar,
                  child: Stack(
                    children: [
                      // Плашка активной вкладки — состояние ПОКОЯ:
                      // стекло существует только под пальцем, как в
                      // системном баре. Без шейдера плашка же ездит
                      // за пальцем — фолбэк для Skia и веба.
                      AnimatedPositioned(
                        duration: dragging ? Duration.zero : Motion.base,
                        curve: Motion.benefit,
                        left: (dragging && !lensReady)
                            ? pillLeft
                            : _lefts[widget.index],
                        top: 6,
                        bottom: 6,
                        width: (dragging && !lensReady)
                            ? pillWidth
                            : _sizes[widget.index],
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: AnimatedOpacity(
                            // Под пальцем плашку сменяет стекло
                            duration: Motion.fast,
                            opacity: (dragging && lensReady) || cartOwnsPill
                                ? 0
                                : 1,
                            child: _Pill(pressed: dragging),
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          for (var i = 0; i < widget.items.length; i++)
                            SizedBox(
                              width: _sizes[i],
                              child: i == widget.cartIndex && expand > 0
                                  ? _CartSlot(
                                      item: widget.items[i],
                                      active: !lensDrag && _activeIndex == i,
                                      total: widget.cartTotal,
                                      count: widget.cartCount,
                                      expand: expand,
                                    )
                                  : _Tab(
                                      item: widget.items[i],
                                      active: !lensDrag && _activeIndex == i,
                                    ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Перекраска сквозь линзу, как в системном баре iOS 26:
          // вторая копия вкладок в акцентном цвете, обрезанная по
          // контуру линзы. Геометрия копии обязана до пикселя
          // совпадать с базовым рядом — поэтому обе рисуются в
          // «неактивной» геометрии (без масштаба и смены начертания),
          // различие только в цвете. Иначе на кромке маски двоится.
          if (lensDrag)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              height: Gap.navBar,
              child: IgnorePointer(
                child: ClipPath(
                  clipper: _LensClipper(
                    rect: Rect.fromLTWH(
                      lensLeft.toDouble(),
                      -_lensOverhang,
                      lensWidth,
                      lensHeight,
                    ),
                  ),
                  child: Row(
                    children: [
                      for (var i = 0; i < widget.items.length; i++)
                        SizedBox(
                          width: _sizes[i],
                          // Корзина с товаром и так акцентная: её слот
                          // повторяем как есть, иначе под линзой он
                          // сместился бы относительно базового ряда.
                          child: i == widget.cartIndex && expand > 0
                              ? _CartSlot(
                                  item: widget.items[i],
                                  active: false,
                                  total: widget.cartTotal,
                                  count: widget.cartCount,
                                  expand: expand,
                                )
                              : _Tab(
                                  item: widget.items[i],
                                  active: false,
                                  overrideColor: c.accent,
                                ),
                        ),
                    ],
                  ),
                ),
              ),
            ),

          // Линза ПОВЕРХ иконок: пакет захватывает всё, что
          // нарисовано под ней — иконки, подписи и край панели, за
          // который она выступает, — и честно преломляет по Снеллу.
          // Своим слоем рендера, а не BackdropFilter: снимок фона у
          // того отдавался по-разному на симуляторе и на устройстве,
          // и линза хватала пиксели не оттуда.
          //
          // Ширина линзы во время жеста не меняется намеренно: у
          // Flutter известная утечка при анимации размера шейдерных
          // фигур (flutter#138627), двигать позицию — безопасно.
          if (lensReady && (dragging || _lensShown))
            AnimatedPositioned(
              // Пока палец на баре — никакой анимации: линза обязана
              // быть ровно под пальцем, а не догонять его. После
              // отпускания она доезжает к выбранной вкладке, догорая.
              duration: dragging ? Duration.zero : Motion.base,
              curve: Motion.benefit,
              // Пилюля в полтора слота: при почти квадратной линзе
              // стадион вырождается в круг, а кромка почти не задевает
              // подпись — гнуть ей нечего. Широкая накрывает буквы
              // соседней вкладки, и преломление видно.
              left: lensLeft,
              top: -_lensOverhang,
              width: lensWidth,
              height: lensHeight,
              child: IgnorePointer(
                child: AnimatedOpacity(
                  // Стекло рождается под пальцем и умирает при
                  // отпускании — в покое остаётся плоская плашка
                  duration: Motion.fast,
                  opacity: dragging ? 1 : 0,
                  onEnd: () {
                    if (_dragX == null && mounted) {
                      setState(() => _lensShown = false);
                    }
                  },
                  child: LiquidGlass.withOwnLayer(
                    shape: LiquidRoundedSuperellipse(
                      borderRadius: lensHeight / 2,
                    ),
                    settings: const LiquidGlassSettings(
                      // Внутри линзы контент остаётся резким
                      blur: 0,
                      // Толще и преломление сильнее, чем раньше:
                      // стекло теперь видно только в движении, и
                      // деформация иконок — весь его смысл
                      thickness: 35,
                      refractiveIndex: 1.45,
                      // Едва заметная дымка: на ровном белом
                      // преломлению не за что зацепиться
                      glassColor: Color(0x0D000000),
                      lightIntensity: 0.7,
                      chromaticAberration: 0.22,
                      // Дефолт пакета 1.5 перекрашивал бы иконки
                      saturation: 1.0,
                    ),
                    child: SizedBox.expand(),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Плашка активной вкладки — состояние покоя.
///
/// Намеренно плоская и тихая: стеклом бар говорит только под пальцем,
/// а два стекла разом — в покое и в жесте — превращают материал в шум.
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
        color: c.ink.withValues(alpha: pressed ? 0.09 : 0.055),
      ),
    );
  }
}

/// Вкладка корзины, когда в ней что-то есть.
///
/// Заменяет собой плавающую плашку, которая раньше висела над баром: две
/// панели внизу перекрывали друг друга и предлагали одно и то же действие.
/// Здесь сумма живёт внутри стекла — слот разъезжается, подпись «Корзина»
/// уступает место цифрам, а число позиций уходит на значок.
class _CartSlot extends StatelessWidget {
  final NavItem item;
  final bool active;
  final int total;
  final int count;

  /// 0 — обычная вкладка, 1 — раскрытая. Промежуточные значения приходят с
  /// анимации, поэтому подпись и капсула проявляются вместе с шириной.
  final double expand;

  const _CartSlot({
    required this.item,
    required this.active,
    required this.total,
    required this.count,
    required this.expand,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return IgnorePointer(
      child: SizedBox(
        height: Gap.navBar,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: c.accent.withValues(alpha: expand),
              borderRadius: R.pill,
            ),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Icon(
                          item.activeIcon,
                          size: 19,
                          color: Color.lerp(
                            active ? c.accent : c.muted,
                            c.surface,
                            expand,
                          ),
                        ),
                        Positioned(
                          right: -6,
                          top: -5,
                          child: Opacity(
                            opacity: expand,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 4,
                                vertical: 1,
                              ),
                              decoration: BoxDecoration(
                                color: c.surface,
                                borderRadius: R.pill,
                              ),
                              child: Text(
                                '$count',
                                style: TextStyle(
                                  fontFamily: 'Golos Text',
                                  fontSize: 9.5,
                                  height: 1,
                                  fontWeight: FontWeight.w700,
                                  color: c.accent,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    // Ширина слота растёт постепенно, и цифры на полпути
                    // не помещаются — отдаём им ровно тот запас, который
                    // уже появился, вместо переполнения на кадр.
                    Flexible(
                      child: Padding(
                        padding: EdgeInsets.only(left: 8 * expand),
                        child: Opacity(
                          opacity: expand,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: AnimatedMoney(
                              total,
                              style: TextStyle(
                                fontFamily: 'Unbounded',
                                fontSize: 13,
                                height: 1,
                                fontWeight: FontWeight.w700,
                                color: c.surface,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final NavItem item;
  final bool active;

  /// Цвет для слоя перекраски под линзой; геометрия при этом неактивная
  final Color? overrideColor;

  const _Tab({required this.item, required this.active, this.overrideColor});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = overrideColor ?? (active ? c.accent : c.muted);

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

/// Вырез по контуру линзы для слоя перекраски. Пересчитывается каждый
/// кадр жеста — прямоугольник приходит от позиции пальца.
class _LensClipper extends CustomClipper<Path> {
  final Rect rect;

  const _LensClipper({required this.rect});

  @override
  Path getClip(Size size) => Path()
    ..addRRect(RRect.fromRectAndRadius(rect, Radius.circular(rect.height / 2)));

  @override
  bool shouldReclip(_LensClipper oldClipper) => oldClipper.rect != rect;
}
