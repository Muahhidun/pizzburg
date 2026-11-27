import { HandoffMethod, Prisma } from '@prisma/client';

/**
 * «Доставлен»: оплата поездки курьеру и наличные на нём. Общая часть для
 * ползунка курьера и отметки раздачи на планшете — начисление одно и то же,
 * кто бы ни нажал. Повтор безопасен: уникальные индексы на задачу.
 *
 * Возвращает false, если заказ уже не в нужном статусе (гонка).
 */
export async function completeDelivery(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string;
    task: { id: string; kind: string; cashToCollect: number; orderId?: string | null };
    courierId: string;
    shiftId: string | null;
    /** Из каких статусов можно закрыть */
    from: ('NEW' | 'READY' | 'ASSIGNED' | 'PICKED_UP')[];
    /** Чей заказ сейчас — для гонки с другим курьером; null — ничей */
    currentCourierId: string | null;
    deliveryPay: number;
    now: Date;
    handoffMethod: HandoffMethod;
    data?: Prisma.DeliveryTaskUpdateManyMutationInput;
  },
): Promise<boolean> {
  const changed = await tx.deliveryTask.updateMany({
    where: { id: p.task.id, status: { in: p.from }, courierId: p.currentCourierId },
    data: {
      status: 'DELIVERED',
      deliveredAt: p.now,
      handoffMethod: p.handoffMethod,
      courierId: p.courierId,
      shiftId: p.shiftId,
      ...p.data,
    },
  });
  if (changed.count === 0) return false;
  await tx.courierPayoutLine.createMany({
    data: [
      {
        tenantId: p.tenantId,
        courierId: p.courierId,
        shiftId: p.shiftId,
        taskId: p.task.id,
        type: p.task.kind === 'EXTRA_TRIP' ? 'EXTRA_TRIP' : 'DELIVERY',
        amount: p.deliveryPay,
      },
    ],
    skipDuplicates: true,
  });
  if (p.task.cashToCollect > 0) {
    const entry = { tenantId: p.tenantId, courierId: p.courierId, taskId: p.task.id, status: 'CONFIRMED' as const };
    const float = p.task.orderId ? await changeFloat(tx, p.task.orderId, p.task.cashToCollect) : 0;
    await tx.courierCashEntry.createMany({
      data: [
        { ...entry, type: 'COLLECTED', amount: p.task.cashToCollect },
        // Отдельной строкой, не в COLLECTED: «клиент заплатил картой»
        // снимает только оплату заказа, а сдачу из кассы курьер всё
        // равно должен вернуть (27.11.2026, заказ №351).
        ...(float > 0 ? [{ ...entry, type: 'CHANGE_FLOAT' as const, amount: float, note: 'Сдача из кассы для клиента' }] : []),
      ],
      skipDuplicates: true,
    });
  }
  return true;
}

/**
 * Сколько сдачи касса положила курьеру к заказу. Клиент просил сдачу с
 * 10 000 при заказе на 6 920 — кассир даёт курьеру 3 080 (см. чек:
 * «ПОЛОЖИТЬ СДАЧУ»). Курьер берёт у клиента 10 000, отдаёт 3 080 — и
 * кассе должен 10 000, а не 6 920.
 */
async function changeFloat(tx: Prisma.TransactionClient, orderId: string, cash: number): Promise<number> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { changeFrom: true } });
  const from = order?.changeFrom ?? 0;
  return from > cash ? from - cash : 0;
}
