import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramUpdatesService } from '../src/telegram/telegram-updates.service';

function service() {
  const calls: string[] = [];
  const telegram: any = {
    call: async (_t: string, method: string) => {
      calls.push(method);
      return { error: null };
    },
  };
  return { updates: new TelegramUpdatesService(telegram), calls };
}

test('апдейт, который никто не взял, уходит дальше — в ответы кассира', async () => {
  const { updates } = service();
  updates.register(async () => false);
  assert.equal(await updates.dispatch('t1', { message: { message_id: 1, chat: { id: 1 } } }), false);
});

test('взятый апдейт дальше не передаётся', async () => {
  const { updates } = service();
  let second = false;
  updates.register(async () => true);
  updates.register(async () => {
    second = true;
    return true;
  });
  assert.equal(await updates.dispatch('t1', { message: { message_id: 1, chat: { id: 1 } } }), true);
  assert.equal(second, false);
});

test('ошибка обработчика не роняет вебхук, а кнопка получает ответ', async () => {
  const { updates, calls } = service();
  updates.register(async () => {
    throw new Error('boom');
  });
  const handled = await updates.dispatch('t1', {
    callback_query: { id: 'q', from: { id: 1 }, data: 'courier:consent' },
  });
  assert.equal(handled, true);
  assert.deepEqual(calls, ['answerCallbackQuery']);
});
