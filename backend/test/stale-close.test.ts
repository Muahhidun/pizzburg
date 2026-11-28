import assert from 'node:assert/strict';
import test from 'node:test';
import { StatusPollerService } from '../src/orders/status-poller.service';

/**
 * Автозакрытие через 3 часа (№357, 27.11.2026): оплаченный Kaspi и так и
 * не принятый заказ сами не отменяем и деньги не возвращаем — кассир могла
 * пробить его вручную и отдать еду. Спрашиваем кассу и руководство.
 */
function setup(orders: Record<string, unknown>[]) {
  const statuses: unknown[][] = [];
  const touched: unknown[] = [];
  const cashier: { text: string; keyboard: any }[] = [];
  const owner: string[] = [];
  const prisma = {
    order: {
      findMany: async () => orders,
      update: async (a: unknown) => touched.push(a),
    },
  };
  const svc = new StatusPollerService(
    prisma as never,
    { setStatus: async (...a: unknown[]) => statuses.push(a) } as never,
    {} as never,
    {
      notifyCashier: async (_t: string, text: string, keyboard: any) => cashier.push({ text, keyboard }),
      notify: async (_t: string, text: string) => owner.push(text),
    } as never,
  );
  return { svc, statuses, touched, cashier, owner };
}

const order = (o: Record<string, unknown>) => ({
  id: 'o1', number: 357, tenantId: 't', total: 6610, createdAt: new Date(Date.now() - 4 * 3_600_000), ...o,
});

test('оплачен Kaspi и не принят — не отменяем, спрашиваем кассу с кнопками', async () => {
  const s = setup([order({ status: 'NEW', paymentMethod: 'KASPI_ONLINE', paymentStatus: 'PAID' })]);
  await s.svc.closeStale();
  assert.equal(s.statuses.length, 0, 'ни отмены, ни возврата');
  assert.match(s.cashier[0].text, /№357 оплачен Kaspi \(6610 ₸\), но за 3 ч его так и не приняли/);
  assert.deepEqual(s.cashier[0].keyboard.map((r: any[]) => r[0].callback_data), ['o:dv:o1', 'o:c:o1']);
  assert.match(s.owner[0], /Деньги сами не возвращаем/);
  assert.ok((s.touched[0] as any).data.updatedAt instanceof Date, 'следующий вопрос — через 3 часа');
});

test('старше суток — больше не спрашиваем', async () => {
  const s = setup([order({ status: 'NEW', paymentMethod: 'KASPI_ONLINE', paymentStatus: 'PAID', createdAt: new Date(Date.now() - 25 * 3_600_000) })]);
  await s.svc.closeStale();
  assert.equal(s.cashier.length + s.statuses.length, 0);
});

test('наличные, не принят — отменяем как раньше; принятый — закрываем выданным', async () => {
  const s = setup([
    order({ status: 'NEW', paymentMethod: 'CASH', paymentStatus: 'PENDING' }),
    order({ id: 'o2', status: 'ACCEPTED', paymentMethod: 'KASPI_ONLINE', paymentStatus: 'PAID' }),
  ]);
  await s.svc.closeStale();
  assert.deepEqual(s.statuses.map((a) => [a[0], a[1], (a[3] as any).cancelledBy]), [
    ['o1', 'CANCELLED', 'AUTO'],
    ['o2', 'DELIVERED', 'AUTO'],
  ]);
  assert.equal(s.cashier.length, 0);
});
