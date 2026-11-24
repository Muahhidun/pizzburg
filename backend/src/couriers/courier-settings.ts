/**
 * Параметры курьерского модуля (docs/COURIER_SYSTEM_SPEC.md §16).
 *
 * Лежат в `Tenant.settings.couriers`, как и прочие настройки тенанта, чтобы
 * их можно было менять без деплоя. Пока админки для них нет — действуют
 * значения по умолчанию.
 */
export interface CourierSettings {
  /// Оплата курьеру за доставку, ₸ (этап 1: как сейчас, 800)
  deliveryPay: number;
  /// Через сколько назначенный и не забранный заказ уходит следующему
  pickupTimeoutMin: number;
  /// За сколько после «Доставлен» курьер должен снова отметиться
  returnWindowMin: number;
  /// Сколько первых смен курьер считается новичком: сдаёт наличку при каждой отметке
  newbieShifts: number;
  /// С какой суммы на руках остальным напоминаем сдать наличку при отметке
  cashRemindThreshold: number;
  /// Через сколько минут напомнить о неподтверждённой сдаче
  cashConfirmRemindMin: number;
  /// Час (по времени сервера), когда в группы уходит итог дня по курьерам
  dailyReportHour: number;
  /// Пауза курьера: длительность и сколько раз за смену
  pauseMin: number;
  pauseMaxPerShift: number;
  /// Тревога «курьер не успеет»: заказу столько минут, а курьеров в очереди нет
  alertNoCourierAtMin: number;
  /// Тревога «не готов»: курьер ждёт, а заказ столько минут в «Новом»
  alertNotReadyMin: number;
  /// Тревога «долго в пути»: от «Забрал» прошло столько минут
  alertOnWayMin: number;
  /// Связка по 2 заказа: максимальный лишний путь, км по прямой (0 — связок нет)
  batchMaxDetourKm: number;
}

export const COURIER_DEFAULTS: CourierSettings = {
  deliveryPay: 800,
  pickupTimeoutMin: 10,
  returnWindowMin: 30,
  newbieShifts: 5,
  cashRemindThreshold: 10_000,
  cashConfirmRemindMin: 15,
  dailyReportHour: 23,
  pauseMin: 15,
  pauseMaxPerShift: 2,
  alertNoCourierAtMin: 40,
  alertNotReadyMin: 25,
  alertOnWayMin: 20,
  batchMaxDetourKm: 1.5,
};

export function courierSettings(tenantSettings: unknown): CourierSettings {
  const raw = ((tenantSettings as Record<string, any>) ?? {}).couriers ?? {};
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    deliveryPay: num(raw.deliveryPay, COURIER_DEFAULTS.deliveryPay),
    pickupTimeoutMin: num(raw.pickupTimeoutMin, COURIER_DEFAULTS.pickupTimeoutMin),
    returnWindowMin: num(raw.returnWindowMin, COURIER_DEFAULTS.returnWindowMin),
    newbieShifts: num(raw.newbieShifts, COURIER_DEFAULTS.newbieShifts),
    cashRemindThreshold: num(raw.cashRemindThreshold, COURIER_DEFAULTS.cashRemindThreshold),
    cashConfirmRemindMin: num(raw.cashConfirmRemindMin, COURIER_DEFAULTS.cashConfirmRemindMin),
    dailyReportHour: num(raw.dailyReportHour, COURIER_DEFAULTS.dailyReportHour),
    pauseMin: num(raw.pauseMin, COURIER_DEFAULTS.pauseMin),
    pauseMaxPerShift: num(raw.pauseMaxPerShift, COURIER_DEFAULTS.pauseMaxPerShift),
    alertNoCourierAtMin: num(raw.alertNoCourierAtMin, COURIER_DEFAULTS.alertNoCourierAtMin),
    alertNotReadyMin: num(raw.alertNotReadyMin, COURIER_DEFAULTS.alertNotReadyMin),
    alertOnWayMin: num(raw.alertOnWayMin, COURIER_DEFAULTS.alertOnWayMin),
    batchMaxDetourKm: num(raw.batchMaxDetourKm, COURIER_DEFAULTS.batchMaxDetourKm),
  };
}
