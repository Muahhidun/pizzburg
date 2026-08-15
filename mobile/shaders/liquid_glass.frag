#include <flutter/runtime_effect.glsl>

// Линза «жидкого стекла» — капсула на весь снимок фона.
//
// Математика повторяет liquid_glass_renderer (whynotmake.it, MIT), который
// в свою очередь построен на shadertoy.com/view/wccSDf: у кромки капсулы
// стекло образует «валик» круглого сечения, по нему строится 3D-нормаль,
// и луч преломляется по закону Снелла (refract). Длинное плечо хода луча
// (thickness * 8) превращает лёгкий наклон поверхности в заметный сдвиг —
// это и есть «затягивание» контента в кромку, по которому глаз узнаёт
// линзу. В плоской середине нормаль вертикальна, луч не отклоняется, и
// контент остаётся резким — как у настоящего стекла и у Apple.
//
// Всё считается в ПИКСЕЛЯХ снимка, а не в нормированных долях: прошлая
// версия работала в долях, растянутых на весь бар (aspect ~7), и профиль
// кромки размазывался горизонтальными полосами через всю панель.
//
// Контракт ImageFilter.shader: первый uniform — vec2 (движок кладёт туда
// размер снимка), первый sampler2D — сам снимок фона под фильтром.

uniform vec2 uSize;

/// Толщина стеклянного валика у кромки, физические пиксели
uniform float uThickness;

/// Показатель преломления (стекло ~1.5)
uniform float uEta;

/// Сила хроматической аберрации (0 — выключена)
uniform float uChroma;

/// Яркость канта по кромке
uniform float uLight;

uniform sampler2D uTexture;

out vec4 fragColor;

// Капсула-«стадион»: отрезок оси с радиусом. В отличие от скруглённого
// прямоугольника у неё нет внутреннего шва, где градиент ломается:
// экранные производные (dFdx) на таком изломе дают мусорные нормали, и
// по линзе шла диагональная цветная рябь. Здесь градиент аналитический
// и гладкий везде.
void main() {
  vec2 f = FlutterFragCoord().xy;
  vec2 uv = f / uSize;
#ifdef IMPELLER_TARGET_OPENGLES
  uv.y = 1.0 - uv.y;
#endif

  vec4 bg = texture(uTexture, uv);

  // Стадион вписан в снимок с полем в 1px под сглаживание клипа
  float radius = uSize.y * 0.5 - 1.0;
  float axisHalf = uSize.x * 0.5 - 1.0 - radius;
  vec2 p = f - uSize * 0.5;
  vec2 toAxis = vec2(p.x - clamp(p.x, -axisHalf, axisHalf), p.y);
  float dist = length(toAxis);
  float sd = dist - radius;

  float alpha = 1.0 - smoothstep(-2.0, 0.0, sd);
  if (alpha < 0.01 || uThickness < 1.0) {
    fragColor = bg;
    return;
  }

  float t = min(uThickness, radius);

  // Высота валика: 0 на кромке, t на глубине t, дальше стекло плоское —
  // середина линзы ничего не искажает, как у настоящего стекла
  float x = t + max(sd, -t);
  float height = sd < -t ? t : sqrt(max(0.0, t * t - x * x));

  // 3D-нормаль: у кромки горизонтальна и смотрит наружу, в глубине
  // вертикальна. Наружу — вдоль аналитического градиента стадиона.
  float ncos = clamp((t + sd) / t, 0.0, 1.0);
  float nsin = sqrt(max(0.0, 1.0 - ncos * ncos));
  vec2 grad = dist > 1e-4 ? toAxis / dist : vec2(0.0, 1.0);
  vec3 nrm = normalize(vec3(grad * ncos, nsin));

  // Снелл: луч сверху вниз преломляется на поверхности валика. Плечо хода
  // луча укорочено против эталонного t*8: наша линза мала, и на длинном
  // плече сдвиг съедал иконку целиком.
  vec3 refr = refract(vec3(0.0, 0.0, -1.0), nrm, 1.0 / uEta);
  float travel = (height + t * 3.0) / max(abs(refr.z), 1e-3);
  vec2 disp = refr.xy * travel;

  // Страховка у самой кромки, где ход луча уходит в бесконечность
  float maxDisp = t * 1.5;
  float dispLen = length(disp);
  if (dispLen > maxDisp) disp *= maxDisp / dispLen;

  // Красный преломляется сильнее синего — цветная кайма по кромке
  float d = uChroma * 0.5;
  vec2 uvR = clamp(uv + disp * (1.0 + d) / uSize, vec2(0.001), vec2(0.999));
  vec2 uvG = clamp(uv + disp / uSize, vec2(0.001), vec2(0.999));
  vec2 uvB = clamp(uv + disp * (1.0 - d) / uSize, vec2(0.001), vec2(0.999));
  vec3 col = vec3(
    texture(uTexture, uvR).r,
    texture(uTexture, uvG).g,
    texture(uTexture, uvB).b
  );

  // Узкий яркий кант по самой кромке: основной свет сверху-слева и слабый
  // ответный снизу-справа, как у эталона. Ровная подсветка по всему
  // контуру выдала бы нарисованный градиент.
  float rimX = sd / 2.0;
  float rim = 1.0 / (1.0 + 0.89 * rimX * rimX);
  vec2 lightDir = normalize(vec2(-0.6, -1.0));
  float mainL = max(0.0, dot(nrm.xy, lightDir));
  float oppL = max(0.0, dot(nrm.xy, -lightDir));
  col += (mainL * mainL + oppL * oppL * 0.6) * rim * uLight;

  fragColor = mix(bg, vec4(col, bg.a), alpha);
}
