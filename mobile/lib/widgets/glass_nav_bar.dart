import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:liquid_glass_renderer/liquid_glass_renderer.dart';
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

  /// Линза остаётся в дереве, пока догорает её фейд после отпускания
  bool _lensShown = false;

  int get _activeIndex => _dragX != null ? _hoverIndex : widget.index;

  void _updateFrom(double dx, double width) {
    final slot = width / widget.items.length;
    final index = (dx ~/ slot).clamp(0, widget.items.length - 1);
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
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final slot = width / widget.items.length;
          final dragging = _dragX != null;

          // Насколько капсула отошла от центра своей вкладки: на полпути
          // между вкладками она растягивается, как капля.
          final centerOf = (_activeIndex + 0.5) * slot;
          final offCenter = dragging
              ? ((_dragX! - centerOf).abs() / (slot / 2)).clamp(0.0, 1.0)
              : 0.0;
          final pillWidth = slot * (1 + 0.14 * offCenter);
          final pillLeft = dragging
              ? (_dragX! - pillWidth / 2).clamp(0.0, width - pillWidth)
              : slot * widget.index;

          // Тот же признак, которым гейтится сам пакет: линза требует
          // Impeller, на Skia и в вебе остаётся цветная капсула.
          final lensReady = ImageFilter.isShaderFilterSupported;
          final lensHeight = Gap.navBar + _lensOverhang * 2;

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
                                  : slot * widget.index,
                              top: 6,
                              bottom: 6,
                              width: (dragging && !lensReady)
                                  ? pillWidth
                                  : slot,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                ),
                                child: AnimatedOpacity(
                                  // Под пальцем плашку сменяет стекло
                                  duration: Motion.fast,
                                  opacity: dragging && lensReady ? 0 : 1,
                                  child: _Pill(pressed: dragging),
                                ),
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
                    left:
                        ((dragging ? _dragX! : slot * (widget.index + 0.5)) -
                                slot * 0.75)
                            .clamp(-6.0, width - slot * 1.5 + 6),
                    top: -_lensOverhang,
                    width: slot * 1.5,
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
                            thickness: 30,
                            refractiveIndex: 1.3,
                            // Едва заметная дымка: на ровном белом
                            // преломлению не за что зацепиться
                            glassColor: Color(0x0D000000),
                            lightIntensity: 0.7,
                            chromaticAberration: 0.5,
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
        },
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
