/**
 * Связки по два заказа (docs/COURIER_SYSTEM_SPEC.md §6.4) — чистая геометрия.
 *
 * Два заказа связываются, только если оба адреса лежат в одну сторону от
 * раздачи. Меряем это «крюком»: насколько круг раздача → A → B → раздача
 * длиннее простой поездки к дальнему адресу и обратно. Адреса в одной
 * стороне дают крюк около нуля, по разные стороны от раздачи — огромный.
 * Круг симметричен, поэтому порядок развоза на крюк не влияет: первым везут
 * более старый заказ.
 *
 * Расстояния по прямой. Для небольшого города этого достаточно: правило
 * отсекает «в разные концы», а не выбирает маршрут.
 */

export type Point = { lat: number; lng: number };

const EARTH_KM = 6371;

export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Лишний путь связки против одиночной поездки к дальнему адресу, км */
export function detourKm(venue: Point, a: Point, b: Point): number {
  const loop = distanceKm(venue, a) + distanceKm(a, b) + distanceKm(b, venue);
  const single = 2 * Math.max(distanceKm(venue, a), distanceKm(venue, b));
  return Math.max(0, loop - single);
}

/**
 * Лучший напарник для заказа: в одну сторону и с наименьшим крюком.
 * Кандидаты без координат не рассматриваются.
 */
export function bestPartner<T extends { point: Point | null }>(
  venue: Point,
  base: Point,
  candidates: T[],
  maxDetourKm: number,
): { item: T; detourKm: number } | null {
  let best: { item: T; detourKm: number } | null = null;
  for (const c of candidates) {
    if (!c.point) continue;
    const d = detourKm(venue, base, c.point);
    if (d <= maxDetourKm && (!best || d < best.detourKm)) best = { item: c, detourKm: d };
  }
  return best;
}

/**
 * Кому добавить заказ вторым. В одну сторону (`anyDirection` выключен) —
 * как `bestPartner`. В любую сторону — подходит любой курьер у раздачи:
 * сначала с наименьшим крюком, кандидаты без координат — следом, в том
 * порядке, в каком пришли (дольше всех ждёт — первым).
 */
export function pickHolder<T extends { point: Point | null }>(
  venue: Point | null,
  base: Point | null,
  candidates: T[],
  maxDetourKm: number,
  anyDirection: boolean,
): { item: T; detourKm: number | null } | null {
  if (!anyDirection) return venue && base ? bestPartner(venue, base, candidates, maxDetourKm) : null;
  if (candidates.length === 0) return null;
  if (venue && base) {
    const measured = candidates.filter((c) => c.point);
    if (measured.length) {
      const best = bestPartner(venue, base, measured, Number.POSITIVE_INFINITY);
      if (best) return best;
    }
  }
  return { item: candidates.find((c) => !c.point) ?? candidates[0], detourKm: null };
}

/**
 * Вторым сейчас или ждать следующего курьера (Дом, 26.11.2026).
 *
 * Считаем, когда клиент получит заказ в каждом варианте:
 * - вторым у курьера у раздачи: сборы + поездка к первому + переезд ко второму;
 * - следующим курьером: когда он будет у раздачи + сборы + поездка.
 * Следующий успевает к сроку — ждём его: вовремя в обоих вариантах, работа
 * достаётся всем. Не успевает — отдаём вторым, если так успеваем; не
 * успевают оба — тот вариант, что раньше (при равенстве — сейчас).
 * Курьеры, которые ещё везут заказ, «следующими» не считаются: когда они
 * вернутся — слишком неточно.
 */
export type EtaMin = { etaPickupMin: number; etaTripMin: number; etaSecondLegMin: number };

export function secondNow(
  now: number,
  deadline: number,
  nextCourierAt: number | null,
  eta: EtaMin,
): { give: boolean; viaHolder: number; viaNext: number | null } {
  const min = 60_000;
  const viaHolder = now + (eta.etaPickupMin + eta.etaTripMin + eta.etaSecondLegMin) * min;
  const viaNext =
    nextCourierAt == null ? null : Math.max(now, nextCourierAt) + (eta.etaPickupMin + eta.etaTripMin) * min;
  let give: boolean;
  if (viaNext != null && viaNext <= deadline) give = false;
  else if (viaHolder <= deadline || viaNext == null) give = true;
  else give = viaHolder <= viaNext;
  return { give, viaHolder, viaNext };
}

/**
 * Улица и дом из адреса точки: «Экибастуз, Ауэзова 47б, ТРЦ …» →
 * { street: «Ауэзова», house: «47б» }. Первая часть, где после слов
 * идёт номер. Нужно, когда у точки не заданы свои координаты.
 */
export function streetHouseOf(address: string): { street: string; house: string } | null {
  for (const part of address.split(',')) {
    const m = part.trim().match(/^(.*\D)\s+(\d+[\p{L}\d/-]*)$/u);
    if (m && m[1].trim()) return { street: m[1].trim(), house: m[2] };
  }
  return null;
}
