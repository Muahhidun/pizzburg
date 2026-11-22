import assert from 'node:assert/strict';
import test from 'node:test';
import { CourierRegistrationService } from '../src/couriers/courier-registration.service';
import { TgUpdate } from '../src/telegram/telegram.types';

const TENANT = 't1';
const CASH_CHAT = -1001;
const COURIER_TG = 555;

/** Сравнение where по равенству полей и NOT: { … } — нам этого хватает */
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !matches(row, v);
    return row[k] === v;
  });
}

function fixture() {
  const couriers: any[] = [];
  const audit: any[] = [];
  const calls: { method: string; payload: any }[] = [];
  let seq = 0;

  const prisma: any = {
    tenant: { findUnique: async () => ({ name: 'PizzBurg' }) },
    adminAuditLog: { create: async ({ data }: any) => audit.push(data) },
    courier: {
      create: async ({ data }: any) => {
        if (couriers.some((c) => c.tenantId === data.tenantId && c.telegramUserId === data.telegramUserId)) {
          const { Prisma } = await import('@prisma/client');
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
        }
        const row = {
          id: `c${++seq}`, fullName: '', phone: null, selfieFileId: null,
          registrationStep: null, consentAt: null, approvedBy: null, approvedAt: null,
          ...data,
        };
        couriers.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => {
        const key = where.tenantId_telegramUserId;
        return couriers.find((c) => c.tenantId === key.tenantId && c.telegramUserId === key.telegramUserId) ?? null;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const row = couriers.find((c) => c.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      findFirst: async ({ where }: any) => couriers.find((c) => matches(c, where)) ?? null,
      update: async ({ where, data }: any) => {
        const row = couriers.find((c) => c.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = couriers.filter((c) => matches(c, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
  };

  const telegram: any = {
    // Как на проде: ошибку возвращает строкой, а не бросает
    call: async (_t: string, method: string, payload: any) => {
      calls.push({ method, payload });
      return { error: null, result: { message_id: calls.length } };
    },
    staffChatIds: async () => [String(CASH_CHAT)],
    cashierTargetChat: async () => String(CASH_CHAT),
  };
  const updates: any = { register: () => undefined };
  const service = new CourierRegistrationService(prisma, telegram, updates);

  let updateId = 0;
  const from = { id: COURIER_TG, first_name: 'Асхат' };
  const privateChat = { id: COURIER_TG, type: 'private' as const };

  return {
    service, couriers, audit, calls,
    text: (text: string) =>
      service.handle(TENANT, {
        update_id: ++updateId,
        message: { message_id: updateId, chat: privateChat, from, text },
      } as TgUpdate),
    message: (extra: any) =>
      service.handle(TENANT, {
        update_id: ++updateId,
        message: { message_id: updateId, chat: privateChat, from, ...extra },
      } as TgUpdate),
    callback: (data: string, chatId: number, user = from, photo = false) =>
      service.handle(TENANT, {
        update_id: ++updateId,
        callback_query: {
          id: `cb${updateId}`, from: user, data,
          message: {
            message_id: 1, chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' },
            ...(photo ? { photo: [{ file_id: 'x', width: 1, height: 1 }] } : {}),
          },
        },
      } as TgUpdate),
    sentTexts: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text as string),
  };
}

async function registerFully(f: ReturnType<typeof fixture>) {
  await f.text('/start courier');
  await f.callback('courier:consent', COURIER_TG);
  await f.text('Иванов  Иван Иванович');
  await f.message({ contact: { phone_number: '87011234567', user_id: COURIER_TG } });
  await f.message({ photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 800, height: 800 }] });
}

test('полная регистрация: анкета заполнена, заявка ушла в кассу карточкой с селфи', async () => {
  const f = fixture();
  await registerFully(f);

  const c = f.couriers[0];
  assert.equal(c.status, 'PENDING');
  assert.equal(c.registrationStep, null);
  assert.equal(c.fullName, 'Иванов Иван Иванович');
  assert.equal(c.phone, '+77011234567');
  assert.equal(c.selfieFileId, 'big');
  assert.ok(c.consentAt instanceof Date);

  const card = f.calls.find((x) => x.method === 'sendPhoto');
  assert.ok(card, 'карточка для кассы отправлена');
  assert.equal(card!.payload.chat_id, String(CASH_CHAT));
  assert.equal(card!.payload.photo, 'big');
  assert.match(card!.payload.caption, /Иванов Иван Иванович/);
});

test('без ссылки курьера бот не начинает регистрацию', async () => {
  const f = fixture();
  await f.text('/start');
  assert.equal(f.couriers.length, 0);
  assert.match(f.sentTexts()[0], /служебный бот/);
});

test('пока не нажато «Согласен», ФИО не принимается', async () => {
  const f = fixture();
  await f.text('/start courier');
  await f.text('Иванов Иван Иванович');
  assert.equal(f.couriers[0].fullName, '');
  assert.equal(f.couriers[0].registrationStep, 'CONSENT');
});

test('одно слово вместо ФИО отклоняется', async () => {
  const f = fixture();
  await f.text('/start courier');
  await f.callback('courier:consent', COURIER_TG);
  await f.text('Асхат');
  assert.equal(f.couriers[0].registrationStep, 'NAME');
  assert.match(f.sentTexts().at(-1)!, /Не похоже на ФИО/);
});

test('чужой контакт вместо своего номера не принимается', async () => {
  const f = fixture();
  await f.text('/start courier');
  await f.callback('courier:consent', COURIER_TG);
  await f.text('Иванов Иван Иванович');
  await f.message({ contact: { phone_number: '87019999999', user_id: 999 } });
  assert.equal(f.couriers[0].phone, null);
  assert.equal(f.couriers[0].registrationStep, 'PHONE');
});

test('номер, уже занятый другим курьером, не принимается', async () => {
  const f = fixture();
  f.couriers.push({ id: 'other', tenantId: TENANT, telegramUserId: '1', phone: '+77011234567', status: 'ACTIVE' });
  await f.text('/start courier');
  await f.callback('courier:consent', COURIER_TG);
  await f.text('Иванов Иван Иванович');
  await f.message({ contact: { phone_number: '+7 701 123 45 67', user_id: COURIER_TG } });
  const me = f.couriers.find((c) => c.telegramUserId === String(COURIER_TG));
  assert.equal(me.phone, null);
  assert.match(f.sentTexts().at(-1)!, /уже зарегистрирован/);
});

test('повторный /start посреди анкеты продолжает с того же шага', async () => {
  const f = fixture();
  await f.text('/start courier');
  await f.callback('courier:consent', COURIER_TG);
  await f.text('/start courier');
  assert.equal(f.couriers.length, 1);
  assert.match(f.sentTexts().at(-1)!, /фамилию, имя и отчество/);
});

test('кассир подтверждает курьера: статус, журнал, сообщение курьеру', async () => {
  const f = fixture();
  await registerFully(f);
  const id = f.couriers[0].id;
  await f.callback(`courier:approve:${id}`, CASH_CHAT, { id: 77, first_name: 'Айгерим' }, true);

  const c = f.couriers[0];
  assert.equal(c.status, 'ACTIVE');
  assert.match(c.approvedBy, /Айгерим/);
  assert.equal(f.audit[0].action, 'COURIER_APPROVED');
  assert.ok(f.calls.some((x) => x.method === 'editMessageCaption'));
  assert.match(f.sentTexts().at(-1)!, /Вы подтверждены/);
});

test('второе нажатие на ту же карточку ничего не меняет', async () => {
  const f = fixture();
  await registerFully(f);
  const id = f.couriers[0].id;
  await f.callback(`courier:approve:${id}`, CASH_CHAT);
  await f.callback(`courier:reject:${id}`, CASH_CHAT);

  assert.equal(f.couriers[0].status, 'ACTIVE');
  const answers = f.calls.filter((x) => x.method === 'answerCallbackQuery');
  assert.equal(answers.at(-1)!.payload.text, 'Уже обработано');
});

test('кнопка подтверждения вне чата кассы не работает', async () => {
  const f = fixture();
  await registerFully(f);
  const id = f.couriers[0].id;
  await f.callback(`courier:approve:${id}`, COURIER_TG);

  assert.equal(f.couriers[0].status, 'PENDING');
  const answers = f.calls.filter((x) => x.method === 'answerCallbackQuery');
  assert.equal(answers.at(-1)!.payload.text, 'Нет доступа');
});

test('сообщения в группах регистрация не трогает', async () => {
  const f = fixture();
  const handled = await f.service.handle(TENANT, {
    update_id: 1,
    message: { message_id: 1, chat: { id: CASH_CHAT, type: 'supergroup' }, from: { id: 1 }, text: '/start courier' },
  });
  assert.equal(handled, false);
  assert.equal(f.couriers.length, 0);
});

test('если карточка для кассы не ушла, регистрация всё равно завершается', async () => {
  const f = fixture();
  const original = (f.service as any).telegram.call;
  (f.service as any).telegram.call = async (t: string, method: string, payload: any) =>
    method === 'sendPhoto' ? { error: 'chat not found' } : original(t, method, payload);
  await registerFully(f);
  assert.equal(f.couriers[0].status, 'PENDING');
});
