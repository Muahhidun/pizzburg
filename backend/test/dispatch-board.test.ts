import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchBoardService, shortName } from '../src/couriers/dispatch-board.service';
import { QR_WINDOW_MS, createQrToken, verifyQrToken } from '../src/couriers/dispatch-qr';

const T0 = 1_800_000_000_000;

test('QR действует в своём и следующем окне, потом нет', () => {
  const { token } = createQrToken('venue1', T0);
  assert.equal(verifyQrToken(token, T0), 'venue1');
  assert.equal(verifyQrToken(token, T0 + QR_WINDOW_MS), 'venue1');
  assert.equal(verifyQrToken(token, T0 + 2 * QR_WINDOW_MS + 1), null);
});

test('подделанный или чужой QR не проходит', () => {
  const { token } = createQrToken('venue1', T0);
  const [p, , w, s] = token.split('.');
  assert.equal(verifyQrToken(`${p}.venue2.${w}.${s}`, T0), null);
  assert.equal(verifyQrToken(`${token}x`, T0), null);
  assert.equal(verifyQrToken('https://example.com', T0), null);
  // Код «из будущего» тоже не принимаем
  const future = createQrToken('venue1', T0 + 5 * QR_WINDOW_MS).token;
  assert.equal(verifyQrToken(future, T0), null);
});

test('короткое имя для плитки', () => {
  assert.equal(shortName('Иванов Иван Иванович'), 'Иван И.');
  assert.equal(shortName('Асхат'), 'Асхат');
});

function fixture(task: any) {
  const events: any[] = [];
  const prisma: any = {
    deliveryTask: {
      findFirst: async ({ where }: any) =>
        where.id === task.id && where.venueId === task.venueId ? { ...task } : null,
      updateMany: async ({ where, data }: any) => {
        if (where.id !== task.id || (where.status && where.status !== task.status)) return { count: 0 };
        Object.assign(task, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => Object.assign(task, data),
    },
    deliveryTaskEvent: { create: async ({ data }: any) => events.push(data) },
  };
  const device = { id: 'd1', tenantId: 't1', venueId: 'v1', name: 'Раздача' };
  const assigned: string[] = [];
  const assignment: any = {
    assignVenue: async (venueId: string) => {
      assigned.push(venueId);
      return 0;
    },
    unassign: async () => false,
  };
  return { service: new DispatchBoardService(prisma, assignment), device, task, events, assigned };
}

test('«Готов» переводит плитку и пишет событие; повтор не ломает', async () => {
  const f = fixture({ id: 'k1', venueId: 'v1', kind: 'DELIVERY', status: 'NEW', readyAt: null });
  await f.service.markReady(f.device, 'k1');
  assert.equal(f.task.status, 'READY');
  assert.ok(f.task.readyAt instanceof Date);
  await f.service.markReady(f.device, 'k1');
  assert.equal(f.events.filter((e) => e.type === 'READY').length, 1);
  // «Готов» сразу запускает раздачу заказов курьерам этой точки
  assert.deepEqual(f.assigned, ['v1']);
});

test('«Отменить» работает только сразу после «Готов»', async () => {
  const f = fixture({ id: 'k1', venueId: 'v1', kind: 'DELIVERY', status: 'NEW', readyAt: null });
  await f.service.markReady(f.device, 'k1');
  await f.service.undoReady(f.device, 'k1');
  assert.equal(f.task.status, 'NEW');
  assert.equal(f.task.readyAt, null);

  const late = fixture({
    id: 'k2', venueId: 'v1', kind: 'DELIVERY', status: 'READY',
    readyAt: new Date(Date.now() - 60_000),
  });
  await assert.rejects(() => late.service.undoReady(late.device, 'k2'), BadRequestException);
});

test('самовывоз выдаётся и из «Нового», доставку так закрыть нельзя', async () => {
  const pickup = fixture({ id: 'p1', venueId: 'v1', kind: 'PICKUP', status: 'NEW', readyAt: null });
  await pickup.service.handOver(pickup.device, 'p1');
  assert.equal(pickup.task.status, 'HANDED_OVER');
  assert.ok(pickup.task.readyAt instanceof Date);

  const delivery = fixture({ id: 'k1', venueId: 'v1', kind: 'DELIVERY', status: 'READY', readyAt: new Date() });
  await assert.rejects(() => delivery.service.handOver(delivery.device, 'k1'), BadRequestException);
});

test('планшет другой точки не видит и не трогает чужие заказы', async () => {
  const f = fixture({ id: 'k1', venueId: 'v1', kind: 'DELIVERY', status: 'NEW', readyAt: null });
  const stranger = { ...f.device, venueId: 'v2' };
  await assert.rejects(() => f.service.markReady(stranger, 'k1'), NotFoundException);
  assert.equal(f.task.status, 'NEW');
});
