#include <flutter/runtime_effect.glsl>

// Линза «жидкого стекла» для таб-бара.
//
// Apple описывает материал тремя свойствами: он преломляет содержимое под
// собой, отражает свет вокруг и даёт «отзывчивое линзирование по краям»
// (developer.apple.com, Liquid Glass). Ровное размытие даёт только третью
// часть — матовость. Здесь добавлены две недостающие: преломление и блик.
//
// Преломление считается не по всей капсуле, а по её КРАЮ: в середине стекло
// плоское и ничего не искажает, у кромки толщина растёт, и луч уходит в
// сторону. Поэтому радужная каёмка появляется именно по контуру, как на
// настоящем стекле.
//
// Контракт ImageFilter.shader: первый uniform обязан быть vec2 (движок
// кладёт туда размер текстуры), первый sampler2D — вход фильтра, то есть
// то, что нарисовано под баром.

uniform vec2 uSize;

// Центр и полуразмеры линзы в долях бара (0..1)
uniform vec2 uCenter;
uniform vec2 uHalf;

// Ширина бара, делённая на высоту. Без этого круглая линза растянулась бы
// вместе с баром в горизонтальный овал.
uniform float uAspect;

// Сила преломления и блика; на 0 линза выключается целиком
uniform float uStrength;

uniform sampler2D uTexture;

out vec4 fragColor;

/// Расстояние до скруглённого прямоугольника: <0 внутри, >0 снаружи
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 uv = FlutterFragCoord().xy / uSize;
#ifdef IMPELLER_TARGET_OPENGLES
  uv.y = 1.0 - uv.y;
#endif

  if (uStrength <= 0.0) {
    fragColor = texture(uTexture, uv);
    return;
  }

  // Пропорциональные координаты: по x растягиваем на соотношение сторон
  vec2 aspect = vec2(uAspect, 1.0);
  vec2 p = (uv - uCenter) * aspect;
  // не `half`: это зарезервированное слово GLSL
  vec2 lens = uHalf * aspect;
  float radius = min(lens.x, lens.y);
  float d = sdRoundedBox(p, lens, radius);

  // Нормаль к поверхности линзы — градиент поля расстояний
  vec2 e = vec2(0.002, 0.0);
  vec2 n = vec2(
    sdRoundedBox(p + e.xy, lens, radius) - sdRoundedBox(p - e.xy, lens, radius),
    sdRoundedBox(p + e.yx, lens, radius) - sdRoundedBox(p - e.yx, lens, radius)
  );
  n = normalize(n + vec2(1e-6));

  // Профиль толщины: 0 в середине линзы, максимум у самой кромки, 0 снаружи
  float inside = 1.0 - smoothstep(-0.02, 0.01, d);
  float rim = smoothstep(-0.30, -0.01, d) * inside;

  vec2 offset = n * rim * uStrength;

  // Хроматическая аберрация: стекло преломляет красный сильнее синего,
  // отсюда цветная кайма по контуру — она и читается глазом как стекло.
  vec4 cr = texture(uTexture, uv - offset * 1.16);
  vec4 cg = texture(uTexture, uv - offset * 1.00);
  vec4 cb = texture(uTexture, uv - offset * 0.84);
  vec3 col = vec3(cr.r, cg.g, cb.b);

  // Блик: свет падает сверху-слева, поэтому верхняя кромка светится, а
  // нижняя — нет. Ровная подсветка по кругу выдаёт нарисованный градиент.
  float spec = pow(max(dot(n, normalize(vec2(0.55, 1.0))), 0.0), 5.0) * rim;
  col += spec * 0.55;

  // Внутри линзы содержимое чуть светлее — стекло собирает свет
  col += inside * 0.04;

  fragColor = vec4(col, cg.a);
}
