import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramService } from '../src/telegram/telegram.service';

/**
 * №103 не попал в группу кассиров: один «fetch failed», и повтора не
 * было. Теперь сбой сети и 5xx/429 повторяются, а если касса так и не
 * получила сообщение — об этом узнаёт руководство.
 */
function serviceWith(responses: (() => Response | never)[]) {
  const prisma = {
    tenant: {
      findUnique: async () => ({
        settings: {
          telegram: { enabled: true, botToken: 'T', chatId: 'OWNER', cashierChatId: 'CASH' },
        },
      }),
    },
    order: { findMany: async () => [] },
  };
  const service = new TelegramService(prisma as never);
  const bodies: { chat_id: string; text: string }[] = [];
  let i = 0;
  service.retryDelaysMs = [0, 0];
  service.fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  }) as never;
  return { service, bodies };
}

const ok = () =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 });
const netFail = () => {
  throw new TypeError('fetch failed');
};
const badChat = () =>
  new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 });

test('сбой сети повторяется и сообщение доходит', async () => {
  const { service, bodies } = serviceWith([netFail, ok]);
  const r = await service.notifyCashier('t1', 'Новый заказ №103');
  assert.deepEqual(r, { sent: true, chatId: 'CASH', messageId: 5 });
  assert.equal(bodies.length, 2);
});

test('ошибку самого сообщения не повторяем, а руководство узнаёт', async () => {
  const { service, bodies } = serviceWith([badChat, ok]);
  const r = await service.notifyCashier('t1', 'Новый заказ №103');
  assert.equal(r.sent, false);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].chat_id, 'OWNER');
  assert.match(bodies[1].text, /Не дошло до группы кассиров/);
  assert.match(bodies[1].text, /Новый заказ №103/);
});

test('после трёх неудач сдаёмся', async () => {
  const { service, bodies } = serviceWith([netFail]);
  const r = await service.notify('t1', 'сводка');
  assert.equal(r.sent, false);
  assert.equal(bodies.length, 3);
});
