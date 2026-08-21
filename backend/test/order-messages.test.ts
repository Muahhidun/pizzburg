import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESSAGE_COOLDOWN_MS,
  MESSAGE_LIMIT_PER_ORDER,
  OrderMessagesService,
} from '../src/orders/order-messages.service';

/**
 * Связь с заведением по живому заказу (DECISIONS §12.21).
 *
 * Кнопка печатает в живой чат смены, поэтому проверяем ровно то, что её
 * защищает: закрытый заказ, частота и предел на заказ.
 */
function serviceWith({
  order,
  count = 0,
  last = null,
}: {
  order: unknown;
  count?: number;
  last?: { createdAt: Date } | null;
}) {
  const sent: string[] = [];
  const created: unknown[] = [];
  const prisma = {
    order: { findUnique: async () => order },
    orderMessage: {
      count: async () => count,
      findFirst: async () => last,
      create: async ({ data }: { data: unknown }) => {
        created.push(data);
        return { id: 'm1' };
      },
    },
  };
  const telegram = {
    notifyCashier: async (_t: string, text: string) => {
      sent.push(text);
    },
    notify: async () => {},
  };
  return {
    service: new OrderMessagesService(prisma as never, telegram as never),
    sent,
    created,
  };
}

const liveOrder = {
  id: 'o1',
  number: 42,
  type: 'DELIVERY',
  status: 'NEW',
  tenantId: 't1',
  address: { street: 'Сатпаева', house: '38А', flat: '3' },
  customer: { phone: '+77070000000' },
};

const now = new Date('2026-08-21T12:00:00Z');

test('обращение уходит кассе с номером, темой и телефоном', async () => {
  const { service, sent } = serviceWith({ order: liveOrder });
  await service.send('o1', { topic: 'WHERE' }, now);

  assert.equal(sent.length, 1);
  assert.match(sent[0], /№42/);
  assert.match(sent[0], /Где мой заказ\?/);
  assert.match(sent[0], /\+77070000000/);
  // Адрес одной строкой — кассиру не нужен разбор структуры
  assert.match(sent[0], /Сатпаева 38А, кв\. 3/);
});

test('свободный текст попадает в сообщение, но тема остаётся', async () => {
  const { service, sent, created } = serviceWith({ order: liveOrder });
  await service.send('o1', { topic: 'MISSING', text: '  забыли соус  ' }, now);

  assert.match(sent[0], /Забыли позицию/);
  assert.match(sent[0], /«забыли соус»/);
  assert.equal((created[0] as { text: string }).text, 'забыли соус');
});

test('самовывоз не выдумывает адрес', async () => {
  const { service, sent } = serviceWith({
    order: { ...liveOrder, type: 'PICKUP', address: null },
  });
  await service.send('o1', { topic: 'WHERE' }, now);
  assert.match(sent[0], /самовывоз/);
});

test('неизвестная тема отклоняется', async () => {
  const { service } = serviceWith({ order: liveOrder });
  await assert.rejects(
    () => service.send('o1', { topic: 'HACK' }, now),
    /Неизвестная тема/,
  );
});

test('по закрытому заказу писать некуда', async () => {
  for (const status of ['DELIVERED', 'CANCELLED']) {
    const { service, sent } = serviceWith({
      order: { ...liveOrder, status },
    });
    await assert.rejects(
      () => service.send('o1', { topic: 'WHERE' }, now),
      /уже закрыт/,
    );
    assert.equal(sent.length, 0);
  }
});

test('второе сообщение подряд не проходит', async () => {
  const { service, sent } = serviceWith({
    order: liveOrder,
    count: 1,
    last: { createdAt: new Date(now.getTime() - MESSAGE_COOLDOWN_MS + 1000) },
  });
  await assert.rejects(
    () => service.send('o1', { topic: 'WHERE' }, now),
    /подождите пару минут/,
  );
  assert.equal(sent.length, 0);

  // Минута прошла — можно снова
  const ok = serviceWith({
    order: liveOrder,
    count: 1,
    last: { createdAt: new Date(now.getTime() - MESSAGE_COOLDOWN_MS - 1) },
  });
  await ok.service.send('o1', { topic: 'WHERE' }, now);
  assert.equal(ok.sent.length, 1);
});

test('больше пяти сообщений на заказ не принимаем', async () => {
  const { service, sent } = serviceWith({
    order: liveOrder,
    count: MESSAGE_LIMIT_PER_ORDER,
    last: { createdAt: new Date(now.getTime() - 10 * MESSAGE_COOLDOWN_MS) },
  });
  await assert.rejects(
    () => service.send('o1', { topic: 'WHERE' }, now),
    /уже получили ваши сообщения/,
  );
  assert.equal(sent.length, 0);
});
