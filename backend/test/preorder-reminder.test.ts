import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreorderReminderService, preorderReminderText } from '../src/orders/preorder-reminder.service';
import { linkOrderNumbers } from '../src/telegram/telegram.service';

test('напоминание о предзаказе: номер ведёт на сообщение о заказе', () => {
  const text = preorderReminderText(143, 30, '19:30 (21.11)', 'DELIVERY');
  assert.match(text, /Через 30 мин предзаказ №143/);
  const linked = linkOrderNumbers(text, '', (n) => `https://t.me/c/1/${n}`);
  assert.match(linked, /<a href="https:\/\/t\.me\/c\/1\/143">№143<\/a>/);
});

function fakeService(orders: any[]) {
  const sent: string[] = [];
  const claimed = new Set<string>();
  const prisma: any = {
    order: {
      findMany: async () => orders,
      updateMany: async ({ where }: any) => {
        if (claimed.has(where.id)) return { count: 0 };
        claimed.add(where.id);
        return { count: 1 };
      },
    },
  };
  const telegram: any = { notifyCashier: async (_t: string, text: string) => sent.push(text) };
  return { svc: new PreorderReminderService(prisma, telegram), sent };
}

test('предзаказ напоминается один раз, свежий заказ — нет', async () => {
  const now = new Date('2026-11-21T14:00:00Z');
  const order = (id: string, createdAt: string) => ({
    id,
    number: id === 'a' ? 1 : 2,
    tenantId: 't',
    type: 'PICKUP',
    createdAt: new Date(createdAt),
    scheduledAt: new Date('2026-11-21T14:30:00Z'),
    tenant: { settings: {} },
  });
  const { svc, sent } = fakeService([
    order('a', '2026-11-21T10:00:00Z'), // оформлен за 4,5 часа
    order('b', '2026-11-21T13:55:00Z'), // за 35 минут — по сути обычный
  ]);
  await svc.run(now);
  await svc.run(now);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /предзаказ №1<\/b> — на 19:30 \(21\.11\), самовывоз/);
});
