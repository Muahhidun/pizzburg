'use client';

/**
 * Что делать с деньгами Kaspi при отмене оплаченного заказа.
 *
 * Раньше отмена всегда возвращала всё. Кассиру нужен выбор: заказ мог
 * быть частично отдан (вернуть часть) или уже съеден (не возвращать).
 * Сумма частичного возврата не может превысить сумму заказа — это же
 * проверяет сервер.
 */
export type RefundMode = 'FULL' | 'PARTIAL' | 'NONE';

export function isPaidOnline(order: { paymentMethod: string; paymentStatus?: string }) {
  return (
    order.paymentMethod === 'KASPI_ONLINE' &&
    ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus ?? '')
  );
}

/** Тело запроса отмены для выбранного варианта или текст ошибки. */
export function refundPayload(
  paid: boolean,
  mode: RefundMode,
  amountText: string,
  total: number,
): { body: { refundMode?: RefundMode; refundAmount?: number } } | { error: string } {
  if (!paid) return { body: {} };
  if (mode !== 'PARTIAL') return { body: { refundMode: mode } };
  const amount = Number(amountText);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { error: 'Укажите сумму возврата целым числом' };
  }
  if (amount > total) {
    return { error: `Вернуть можно не больше ${total} ₸` };
  }
  return { body: { refundMode: 'PARTIAL', refundAmount: amount } };
}

export function RefundChoice({
  total,
  mode,
  onMode,
  amount,
  onAmount,
}: {
  total: number;
  mode: RefundMode;
  onMode: (m: RefundMode) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  const option = (value: RefundMode, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
      <input type="radio" checked={mode === value} onChange={() => onMode(value)} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="mt-3 rounded-xl border border-black/10 p-2 dark:border-white/15">
      <p className="px-2 pb-1 text-sm font-medium">Вернуть деньги на Kaspi?</p>
      {option('FULL', `Да, полностью — ${total} ₸`)}
      {option('PARTIAL', 'Частично')}
      {mode === 'PARTIAL' && (
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={total}
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder={`Сумма, не больше ${total} ₸`}
          className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm dark:border-white/15"
        />
      )}
      {option('NONE', 'Нет, не возвращать')}
    </div>
  );
}
