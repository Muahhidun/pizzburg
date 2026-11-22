import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TelegramRepliesController,
  TelegramRepliesService,
  webhookSecret,
} from '../src/orders/telegram-replies.controller';

/**
 * Ответ кассира из группы: кнопкой или текстом ответом на вопрос.
 */
function setup(message: Record<string, unknown> | null) {
  const answers: unknown[][] = [];
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const updates: unknown[] = [];
  const prisma = {
    tenant: {
      findUnique: async () => ({ id: 't1', settings: { telegram: { botToken: 'TOKEN' } } }),
    },
    orderMessage: {
      findFirst: async () => message,
      update: async (a: unknown) => updates.push(a),
    },
  };
  const telegram = {
    call: async (_t: string, method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      return { error: null, result: { message_id: 900 } };
    },
    rememberChat: () => {},
  };
  const messages = {
    answer: async (...args: unknown[]) => {
      answers.push(args);
      return { ok: true };
    },
  };
  const service = new TelegramRepliesService(prisma as never, telegram as never, messages as never);
  // Курьерский модуль апдейты не берёт — всё идёт в ответы кассира
  const moduleUpdates = { dispatch: async () => false };
  const controller = new TelegramRepliesController(prisma as never, service, moduleUpdates as never);
  return { controller, answers, calls, updates };
}

const question = {
  id: 'm1',
  topic: 'WHERE',
  answeredAt: null,
  answeredBy: null,
  telegramChatId: '-100',
  telegramMessageId: 77,
  replyPromptMessageId: null,
  order: { number: 103 },
};
const secret = webhookSecret('TOKEN', 't1');
const from = { id: 1, first_name: 'Альбина' };

test('без секрета Телеграма вебхук не принимает ничего', async () => {
  const { controller, answers } = setup(question);
  await assert.rejects(() =>
    controller.webhook('pizzburg', 'wrong', {
      callback_query: { id: 'q', from, data: 'r:m1:1' },
    }),
  );
  assert.equal(answers.length, 0);
});

test('кнопка готового ответа отвечает клиенту от имени нажавшего', async () => {
  const { controller, answers, calls } = setup(question);
  await controller.webhook('pizzburg', secret, {
    callback_query: { id: 'q', from, data: 'r:m1:1' },
  });
  assert.deepEqual(answers, [['m1', 'Курьер уже в пути', 'Альбина']]);
  assert.equal(calls.at(-1)?.method, 'answerCallbackQuery');
  assert.equal(calls.at(-1)?.payload.text, 'Ответ отправлен клиенту');
});

test('на отвеченный вопрос кнопка говорит, кто уже ответил', async () => {
  const { controller, answers, calls } = setup({
    ...question,
    answeredAt: new Date(),
    answeredBy: 'Мадина',
  });
  await controller.webhook('pizzburg', secret, {
    callback_query: { id: 'q', from, data: 'r:m1:0' },
  });
  assert.equal(answers.length, 0);
  assert.equal(calls.at(-1)?.payload.text, 'Уже ответили: Мадина');
});

test('«Свой ответ» просит написать текст и ловит ответ на подсказку', async () => {
  const { controller, calls, updates } = setup(question);
  await controller.webhook('pizzburg', secret, {
    callback_query: { id: 'q', from, data: 'c:m1' },
  });
  const prompt = calls.find((c) => c.method === 'sendMessage');
  assert.ok(prompt);
  assert.deepEqual(prompt.payload.reply_markup, { force_reply: true, selective: true });
  assert.deepEqual(updates, [{ where: { id: 'm1' }, data: { replyPromptMessageId: 900 } }]);

  const second = setup({ ...question, replyPromptMessageId: 900 });
  await second.controller.webhook('pizzburg', secret, {
    message: {
      message_id: 901,
      chat: { id: -100 },
      from,
      text: 'Курьер будет через 5 минут',
      reply_to_message: { message_id: 900 },
    },
  });
  assert.deepEqual(second.answers, [['m1', 'Курьер будет через 5 минут', 'Альбина']]);
  assert.ok(second.calls.some((c) => c.method === 'deleteMessage'));
});

test('обычная переписка в группе ответом не считается', async () => {
  const { controller, answers } = setup(null);
  await controller.webhook('pizzburg', secret, {
    message: { message_id: 5, chat: { id: -100 }, from, text: 'Ок' },
  });
  assert.equal(answers.length, 0);
});
