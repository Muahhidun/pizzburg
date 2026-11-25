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
    task: { id: string; kind: string; cashToCollect: number };
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
    await tx.courierCashEntry.createMany({
      data: [
        {
          tenantId: p.tenantId,
          courierId: p.courierId,
          taskId: p.task.id,
          type: 'COLLECTED',
          status: 'CONFIRMED',
          amount: p.task.cashToCollect,
        },
      ],
      skipDuplicates: true,
    });
  }
  return true;
}
