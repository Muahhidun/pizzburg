import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Courier, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { TelegramUpdatesService } from '../telegram/telegram-updates.service';
import { TgCallbackQuery, TgMessage, TgUpdate, tgUserLabel } from '../telegram/telegram.types';
import { AssignmentService } from './assignment.service';
import { courierSettings } from './courier-settings';
import { shortName } from './names';
import { orderOf } from './task-order';

/**
 * Наличка курьеров и расчёт в конце смены (docs/COURIER_SYSTEM_SPEC.md §8).
 *
 * Сдача подтверждается с двух сторон: курьер нажимает «Сдаю», кассир в
 * своей группе — «Принял». Пока кассир не нажал, долг остаётся на
 * курьере, поэтому ложной сдачи не бывает.
 *
 * В конце смены — взаимозачёт: курьер держит наличку, заведение должно ему
 * за доставки, и деньги переходят один раз, в одну сторону.
 */

const CB = {
  ok: 'cash:ok:',
  no: 'cash:no:',
  other: 'cash:other:',
  settleOk: 'settle:ok:',
  settleNo: 'settle:no:',
  payOk: 'pay:ok:',
  payNo: 'pay:no:',
};

export type PaidBy = 'CARD' | 'KASPI';
const PAID_BY_TEXT: Record<PaidBy, string> = { CARD: 'картой через терминал', KASPI: 'через Kaspi' };

const tenge = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

/** Взаимозачёт: кто кому сколько отдаёт */
export function netting(earned: number, cashHeld: number) {
  return {
    courierPays: Math.max(cashHeld - earned, 0),
    venuePays: Math.max(earned - cashHeld, 0),
    offset: Math.min(cashHeld, earned),
  };
}

export function settlementText(s: {
  name: string;
  deliveries: number;
  earned: number;
  cashHeld: number;
  courierPays: number;
  venuePays: number;
}): string {
  const lines = [
    `Доставок: ${s.deliveries} · заработано ${tenge(s.earned)}`,
    `Наличных на руках: ${tenge(s.cashHeld)}`,
    '',
  ];
  if (s.courierPays > 0) {
    lines.push(
      `<b>Курьер сдаёт кассе ${tenge(s.courierPays)}</b>` +
        (s.earned > 0 ? `, свои ${tenge(s.earned)} оставляет себе.` : '.'),
    );
  } else if (s.venuePays > 0) {
    lines.push(
      `<b>Касса платит курьеру ${tenge(s.venuePays)}</b>` +
        (s.cashHeld > 0 ? `, наличные ${tenge(s.cashHeld)} курьер оставляет себе.` : '.'),
    );
  } else {
    lines.push('<b>Никто никому не должен</b>: наличные равны заработку.');
  }
  return lines.join('\n');
}

@Injectable()
export class CourierCashService implements OnModuleInit {
  private readonly logger = new Logger(CourierCashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly updates: TelegramUpdatesService,
    private readonly assignment: AssignmentService,
  ) {}

  onModuleInit() {
    this.updates.register((tenantId, update) => this.handle(tenantId, update));
  }

  // ─── Счёт курьера ──────────────────────────────────────────────

  async balance(courierId: string): Promise<number> {
    const r = await this.prisma.courierCashEntry.aggregate({
      where: { courierId, status: 'CONFIRMED' },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  async unsettled(courierId: string, upTo?: Date) {
    const where: Prisma.CourierPayoutLineWhereInput = {
      courierId,
      settledAt: null,
      ...(upTo ? { createdAt: { lte: upTo } } : {}),
    };
    const [sum, trips] = await Promise.all([
      this.prisma.courierPayoutLine.aggregate({ where, _sum: { amount: true } }),
      this.prisma.courierPayoutLine.count({
        where: { ...where, type: { in: ['DELIVERY', 'EXTRA_TRIP'] } },
      }),
    ]);
    return { earned: sum._sum.amount ?? 0, deliveries: trips };
  }

  /** Блок «Наличка» для экрана курьера */
  async summary(courierId: string) {
    const [balance, pending, settlement, cashOrders] = await Promise.all([
      this.balance(courierId),
      this.prisma.courierCashEntry.findFirst({
        where: { courierId, type: 'HANDED_IN', status: 'PENDING' },
      }),
      this.prisma.courierSettlement.findFirst({ where: { courierId, status: 'PENDING' } }),
      this.cashOrders(courierId),
    ]);
    return {
      cashOrders,
      balance,
      pendingHandover: pending
        ? { amount: pending.claimedAmount ?? -pending.amount, createdAt: pending.createdAt.toISOString() }
        : null,
      settlement: settlement
        ? {
            earned: settlement.earned,
            cashHeld: settlement.cashHeld,
            courierPays: settlement.courierPays,
            venuePays: settlement.venuePays,
          }
        : null,
    };
  }

  /**
   * Заказы за наличные, которые курьер отвёз за последние сутки и деньги
   * по которым ещё не сданы: по ним можно сказать «клиент оплатил иначе».
   */
  private async cashOrders(courierId: string) {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const collected = await this.prisma.courierCashEntry.findMany({
      where: { courierId, type: 'COLLECTED', status: 'CONFIRMED', createdAt: { gte: since }, taskId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { task: { include: { order: { select: { number: true } } } } },
    });
    if (collected.length === 0) return [];
    const changes = await this.prisma.courierCashEntry.findMany({
      where: { courierId, type: 'ADJUSTMENT', taskId: { in: collected.map((c) => c.taskId!) } },
      orderBy: { createdAt: 'desc' },
    });
    return collected.map((c) => {
      const change = changes.find((a) => a.taskId === c.taskId) ?? null;
      return {
        taskId: c.taskId!,
        number: c.task ? orderOf(c.task).number : '—',
        amount: c.amount,
        paidOtherwise: change ? { status: change.status, paidBy: change.paidBy } : null,
      };
    });
  }

  // ─── «Клиент оплатил иначе» ────────────────────────────────────

  /**
   * Курьер отвёз заказ «за наличные», а клиент заплатил картой или
   * через Kaspi (Дом, 25.11.2026). Курьер сам долг не списывает: кассиру
   * приходит карточка, он сверяет по терминалу или Kaspi и подтверждает.
   * До подтверждения наличные числятся на курьере.
   */
  async requestPaidOtherwise(tenantId: string, courier: Courier, taskId: string, paidBy: PaidBy) {
    const collected = await this.prisma.courierCashEntry.findFirst({
      where: { tenantId, courierId: courier.id, taskId, type: 'COLLECTED', status: 'CONFIRMED' },
      include: { task: { include: { order: { select: { number: true } } } } },
    });
    if (!collected) throw new BadRequestException('По этому заказу наличных на вас нет');
    const before = await this.prisma.courierCashEntry.findFirst({
      where: { courierId: courier.id, taskId, type: 'ADJUSTMENT', status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (before) {
      throw new BadRequestException(before.status === 'PENDING' ? 'Уже отправлено кассиру, ждём ответа' : 'Кассир уже подтвердил');
    }
    const number = collected.task ? orderOf(collected.task).number : '—';
    const entry = await this.prisma.courierCashEntry.create({
      data: {
        tenantId,
        courierId: courier.id,
        taskId,
        type: 'ADJUSTMENT',
        status: 'PENDING',
        amount: -collected.amount,
        paidBy,
        note: `№${number}: клиент оплатил ${PAID_BY_TEXT[paidBy]}`,
      },
    });
    const chat = await this.telegram.cashierTargetChat(tenantId);
    if (chat) {
      const { result } = await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: chat,
        parse_mode: 'HTML',
        text:
          `💳 <b>${esc(shortName(courier.fullName))}: №${esc(number)} оплачен ${PAID_BY_TEXT[paidBy]}</b>\n` +
          `Курьер говорит, что ${tenge(collected.amount)} клиент заплатил не наличными. ` +
          (paidBy === 'CARD' ? 'Проверьте по терминалу' : 'Проверьте перевод в Kaspi') +
          ' и подтвердите — тогда эта сумма снимется с курьера.',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Подтверждаю', callback_data: `${CB.payOk}${entry.id}` },
              { text: '✖ Нет, были наличные', callback_data: `${CB.payNo}${entry.id}` },
            ],
          ],
        },
      });
      if (result?.message_id) {
        await this.prisma.courierCashEntry.update({
          where: { id: entry.id },
          data: { cardChatId: chat, cardMessageId: result.message_id },
        });
      }
    }
    return entry;
  }

  async resolvePaidOtherwise(tenantId: string, entryId: string, who: string, ok: boolean) {
    const entry = await this.prisma.courierCashEntry.findFirst({
      where: { id: entryId, tenantId, type: 'ADJUSTMENT' },
      include: { courier: true, task: { include: { order: { select: { number: true } } } } },
    });
    if (!entry) return false;
    const changed = await this.prisma.courierCashEntry.updateMany({
      where: { id: entryId, status: 'PENDING' },
      data: { status: ok ? 'CONFIRMED' : 'REJECTED', resolvedBy: who, resolvedAt: new Date() },
    });
    if (changed.count === 0) return false;
    const number = entry.task ? orderOf(entry.task).number : '—';
    const amount = -entry.amount;
    const paidBy = (entry.paidBy ?? 'CARD') as PaidBy;
    if (ok && entry.taskId) {
      // Заказ больше не «за наличные»: так он и попадёт в отчёты
      await this.prisma.deliveryTask.update({
        where: { id: entry.taskId },
        data: { cashToCollect: 0, ...(paidBy === 'CARD' ? { needsTerminal: true } : {}) },
      });
      await this.prisma.deliveryTaskEvent.create({
        data: {
          tenantId,
          taskId: entry.taskId,
          courierId: entry.courierId,
          type: 'PAYMENT_CHANGED',
          actor: `CASHIER:${who}`,
          meta: { from: 'CASH', to: paidBy, amount },
        },
      });
    }
    await this.closeCard(
      tenantId,
      entry.cardChatId,
      entry.cardMessageId,
      ok ? `✅ Подтвердил(а): ${esc(who)}` : `✖ Наличные были, долг остаётся: ${esc(who)}`,
    );
    const left = await this.balance(entry.courierId);
    await this.assignment.sendToCourier(
      tenantId,
      entry.courier.telegramUserId,
      ok
        ? `Кассир подтвердил: №${number} оплачен ${PAID_BY_TEXT[paidBy]}, ${tenge(amount)} сняты с вас. На руках: ${tenge(left)}.`
        : `Кассир не подтвердил оплату №${number} ${PAID_BY_TEXT[paidBy]}: ${tenge(amount)} остаются на вас. На руках: ${tenge(left)}.`,
    );
    return true;
  }

  // ─── Сдача налички ─────────────────────────────────────────────

  /**
   * «Сдаю»: карточка в чате кассы с кнопками. `arrival` — курьер только
   * что отметился, и сдать попросила система (новичок или большая сумма).
   */
  async requestHandover(tenantId: string, courier: Courier, source: 'COURIER' | 'ARRIVAL') {
    const amount = await this.balance(courier.id);
    if (amount <= 0) {
      if (source === 'COURIER') throw new BadRequestException('Наличных на руках нет');
      return null;
    }
    let entry;
    try {
      entry = await this.prisma.courierCashEntry.create({
        data: {
          tenantId,
          courierId: courier.id,
          type: 'HANDED_IN',
          status: 'PENDING',
          amount: -amount,
          claimedAmount: amount,
          note: source === 'ARRIVAL' ? 'Попросила система при отметке' : null,
        },
      });
    } catch (e) {
      // Уже ждёт подтверждения: вторую карточку не плодим
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }

    const name = shortName(courier.fullName);
    const chat = await this.telegram.cashierTargetChat(tenantId);
    if (chat) {
      const { result } = await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: chat,
        parse_mode: 'HTML',
        text:
          `💵 <b>${esc(name)} сдаёт ${tenge(amount)}</b>\n` +
          (source === 'ARRIVAL'
            ? 'Курьер приехал. Заберите у него наличные и подтвердите.'
            : 'Курьер нажал «Сдаю». Примите наличные и подтвердите.'),
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Принял', callback_data: `${CB.ok}${entry.id}` },
              { text: '✖ Не получил', callback_data: `${CB.no}${entry.id}` },
            ],
            [{ text: '✏️ Другая сумма', callback_data: `${CB.other}${entry.id}` }],
          ],
        },
      });
      if (result?.message_id) {
        await this.prisma.courierCashEntry.update({
          where: { id: entry.id },
          data: { cardChatId: chat, cardMessageId: result.message_id },
        });
      }
    }
    if (source === 'ARRIVAL') {
      await this.assignment.sendToCourier(
        tenantId,
        courier.telegramUserId,
        `💵 Сдайте кассиру ${tenge(amount)}. Кассир подтвердит у себя.`,
      );
    }
    return entry;
  }

  /** При отметке «Я на месте»: новичок сдаёт всё, остальные — от порога */
  async onArrival(tenantId: string, tenantSettings: unknown, courier: Courier) {
    const cfg = courierSettings(tenantSettings);
    const amount = await this.balance(courier.id);
    if (amount <= 0) return;
    const newbie = courier.completedShifts < cfg.newbieShifts;
    if (newbie || amount >= cfg.cashRemindThreshold) {
      await this.requestHandover(tenantId, courier, 'ARRIVAL');
    }
  }

  // ─── Расчёт в конце смены ──────────────────────────────────────

  async createSettlement(
    tenantId: string,
    courier: Courier,
    shiftId: string | null,
    closedBy: 'COURIER' | 'DISPATCH' | 'AUTO' = 'COURIER',
  ) {
    // Неподтверждённая сдача входит в расчёт: две карточки на одни и те
    // же деньги кассира бы запутали
    const pending = await this.prisma.courierCashEntry.findMany({
      where: { courierId: courier.id, type: 'HANDED_IN', status: 'PENDING' },
    });
    for (const p of pending) {
      await this.prisma.courierCashEntry.update({
        where: { id: p.id },
        data: { status: 'REJECTED', resolvedBy: 'SYSTEM', resolvedAt: new Date(), note: 'Вошла в расчёт смены' },
      });
      await this.closeCard(tenantId, p.cardChatId, p.cardMessageId, '↪️ Вошло в расчёт смены ниже');
    }

    const now = new Date();
    const { earned, deliveries } = await this.unsettled(courier.id, now);
    const cashHeld = Math.max(await this.balance(courier.id), 0);
    if (earned === 0 && cashHeld === 0) return null;
    const { courierPays, venuePays } = netting(earned, cashHeld);

    let settlement;
    try {
      settlement = await this.prisma.courierSettlement.create({
        data: {
          tenantId,
          courierId: courier.id,
          shiftId,
          earned,
          cashHeld,
          courierPays,
          venuePays,
          deliveries,
          createdAt: now,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.courierSettlement.findFirst({
          where: { courierId: courier.id, status: 'PENDING' },
        });
      }
      throw e;
    }

    const name = shortName(courier.fullName);
    const body = settlementText({ name, deliveries, earned, cashHeld, courierPays, venuePays });
    const chat = await this.telegram.cashierTargetChat(tenantId);
    if (chat) {
      const { result } = await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: chat,
        parse_mode: 'HTML',
        text:
          closedBy === 'AUTO'
            ? `🧾 <b>Расчёт: ${esc(name)} не закрыл смену</b> — её закрыла система ночью\n${body}`
            : closedBy === 'DISPATCH'
              ? `🧾 <b>Расчёт: ${esc(name)}</b> — смену закрыла раздача\n${body}`
              : `🧾 <b>Расчёт: ${esc(name)} закончил смену</b>\n${body}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Рассчитались', callback_data: `${CB.settleOk}${settlement.id}` },
              { text: '⚠️ Не сошлось', callback_data: `${CB.settleNo}${settlement.id}` },
            ],
          ],
        },
      });
      if (result?.message_id) {
        await this.prisma.courierSettlement.update({
          where: { id: settlement.id },
          data: { cardChatId: chat, cardMessageId: result.message_id },
        });
      }
    }
    await this.assignment.sendToCourier(
      tenantId,
      courier.telegramUserId,
      (closedBy === 'AUTO'
        ? '🧾 Вы не закрыли смену — система закрыла её сама.'
        : '🧾 Смена закончена.') + `\n${body}\n\nПодойдите к кассиру для расчёта.`,
    );
    return settlement;
  }

  // ─── Кнопки и ответы кассира ───────────────────────────────────

  async handle(tenantId: string, update: TgUpdate): Promise<boolean> {
    const cb = update.callback_query;
    if (cb?.data && /^(cash|settle|pay):/.test(cb.data)) {
      await this.onButton(tenantId, cb);
      return true;
    }
    const m = update.message;
    if (m?.reply_to_message && m.text) return this.onAmountReply(tenantId, m);
    return false;
  }

  private async onButton(tenantId: string, cb: TgCallbackQuery) {
    const answer = (text: string) =>
      this.telegram.call(tenantId, 'answerCallbackQuery', { callback_query_id: cb.id, text });
    const staff = await this.telegram.staffChatIds(tenantId);
    if (!staff.includes(String(cb.message?.chat.id ?? ''))) return answer('Нет доступа');

    const data = cb.data!;
    const who = tgUserLabel(cb.from);
    const id = data.slice(data.lastIndexOf(':') + 1);

    if (data.startsWith(CB.settleOk) || data.startsWith(CB.settleNo)) {
      const ok = data.startsWith(CB.settleOk);
      const done = ok ? await this.confirmSettlement(tenantId, id, who) : await this.disputeSettlement(tenantId, id, who);
      return answer(done ? (ok ? 'Расчёт закрыт' : 'Отправлено руководству') : 'Уже обработано');
    }

    if (data.startsWith(CB.payOk) || data.startsWith(CB.payNo)) {
      const ok = data.startsWith(CB.payOk);
      const done = await this.resolvePaidOtherwise(tenantId, id, who, ok);
      return answer(done ? (ok ? 'Подтверждено' : 'Отмечено') : 'Уже обработано');
    }

    const entry = await this.prisma.courierCashEntry.findFirst({
      where: { id, tenantId, type: 'HANDED_IN' },
      include: { courier: true },
    });
    if (!entry || entry.status !== 'PENDING') return answer('Уже обработано');

    if (data.startsWith(CB.other)) {
      const { result } = await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: cb.message!.chat.id,
        parse_mode: 'HTML',
        text:
          `✏️ <a href="tg://user?id=${cb.from.id}">${esc(cb.from.first_name ?? 'Кассир')}</a>, ` +
          `сколько приняли от ${esc(shortName(entry.courier.fullName))}? Ответьте числом на это сообщение.`,
        reply_to_message_id: cb.message!.message_id,
        allow_sending_without_reply: true,
        reply_markup: { force_reply: true, selective: true },
      });
      if (result?.message_id) {
        await this.prisma.courierCashEntry.update({
          where: { id },
          data: { promptMessageId: result.message_id },
        });
      }
      return answer('Напишите сумму ответом');
    }

    const accepted = data.startsWith(CB.ok);
    const done = await this.resolveHandover(tenantId, id, who, accepted ? -entry.amount : null);
    return answer(done ? (accepted ? 'Принято' : 'Отмечено') : 'Уже обработано');
  }

  /** Ответ числом на «сколько приняли?» */
  private async onAmountReply(tenantId: string, m: TgMessage): Promise<boolean> {
    const entry = await this.prisma.courierCashEntry.findFirst({
      where: {
        tenantId,
        type: 'HANDED_IN',
        promptMessageId: m.reply_to_message!.message_id,
        cardChatId: String(m.chat.id),
      },
    });
    if (!entry) return false;
    const amount = Number(m.text!.replace(/[^\d]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: m.chat.id,
        reply_to_message_id: m.message_id,
        text: 'Не понял сумму. Ответьте на подсказку одним числом, например 15000.',
      });
      return true;
    }
    const done = await this.resolveHandover(tenantId, entry.id, m.from ? tgUserLabel(m.from) : 'Кассир', amount);
    await this.telegram.call(tenantId, 'setMessageReaction', {
      chat_id: m.chat.id,
      message_id: m.message_id,
      reaction: [{ type: 'emoji', emoji: done ? '👍' : '🤷' }],
    });
    if (done) {
      await this.telegram.call(tenantId, 'deleteMessage', {
        chat_id: m.chat.id,
        message_id: entry.promptMessageId,
      });
    }
    return true;
  }

  /** received: сколько кассир принял; null — «Не получил» */
  async resolveHandover(tenantId: string, entryId: string, who: string, received: number | null) {
    const entry = await this.prisma.courierCashEntry.findFirst({
      where: { id: entryId, tenantId },
      include: { courier: true },
    });
    if (!entry) return false;
    const claimed = entry.claimedAmount ?? -entry.amount;
    const changed = await this.prisma.courierCashEntry.updateMany({
      where: { id: entryId, status: 'PENDING' },
      data:
        received === null
          ? { status: 'REJECTED', resolvedBy: who, resolvedAt: new Date() }
          : { status: 'CONFIRMED', amount: -received, resolvedBy: who, resolvedAt: new Date() },
    });
    if (changed.count === 0) return false;

    const left = await this.balance(entry.courierId);
    const verdict =
      received === null
        ? `✖ Не получил(а): ${esc(who)}`
        : `✅ Принял(а) ${tenge(received)}${received !== claimed ? ` из заявленных ${tenge(claimed)}` : ''}: ${esc(who)}`;
    await this.closeCard(tenantId, entry.cardChatId, entry.cardMessageId, verdict);
    await this.assignment.sendToCourier(
      tenantId,
      entry.courier.telegramUserId,
      received === null
        ? `Кассир отметил, что не получил ${tenge(claimed)}. Если это ошибка, сдайте ещё раз кнопкой «Сдаю».`
        : `Кассир принял ${tenge(received)}. На руках: ${tenge(left)}.`,
    );
    return true;
  }

  async confirmSettlement(tenantId: string, id: string, who: string) {
    const s = await this.prisma.courierSettlement.findFirst({
      where: { id, tenantId },
      include: { courier: true },
    });
    if (!s) return false;
    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.courierSettlement.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CONFIRMED', resolvedBy: who, resolvedAt: now },
      });
      if (changed.count === 0) return false;
      await tx.courierPayoutLine.updateMany({
        where: { courierId: s.courierId, settledAt: null, createdAt: { lte: s.createdAt } },
        data: { settledAt: now },
      });
      const { offset } = netting(s.earned, s.cashHeld);
      const entries: Prisma.CourierCashEntryCreateManyInput[] = [];
      if (offset > 0) {
        entries.push({
          tenantId, courierId: s.courierId, type: 'PAYOUT_OFFSET', status: 'CONFIRMED',
          amount: -offset, resolvedBy: who, resolvedAt: now, note: `Расчёт ${id}`,
        });
      }
      if (s.courierPays > 0) {
        entries.push({
          tenantId, courierId: s.courierId, type: 'HANDED_IN', status: 'CONFIRMED',
          amount: -s.courierPays, resolvedBy: who, resolvedAt: now, note: `Расчёт ${id}`,
        });
      }
      if (entries.length) await tx.courierCashEntry.createMany({ data: entries });
      return true;
    });
    if (!done) return false;
    await this.closeCard(tenantId, s.cardChatId, s.cardMessageId, `✅ Рассчитались: ${esc(who)}`);
    await this.assignment.sendToCourier(tenantId, s.courier.telegramUserId, '✅ Расчёт за смену закрыт. Спасибо!');
    return true;
  }

  async disputeSettlement(tenantId: string, id: string, who: string) {
    const s = await this.prisma.courierSettlement.findFirst({
      where: { id, tenantId },
      include: { courier: true },
    });
    if (!s) return false;
    const changed = await this.prisma.courierSettlement.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'DISPUTED', resolvedBy: who, resolvedAt: new Date() },
    });
    if (changed.count === 0) return false;
    await this.closeCard(tenantId, s.cardChatId, s.cardMessageId, `⚠️ Не сошлось: ${esc(who)}. Передано руководству.`);
    await this.telegram.notify(
      tenantId,
      `⚠️ <b>Расчёт с курьером не сошёлся</b>\n${esc(s.courier.fullName)}\n` +
        settlementText({ name: s.courier.fullName, ...s }) +
        `\n\nОтметил(а): ${esc(who)}`,
    );
    return true;
  }

  // ─── Напоминания и итог дня ────────────────────────────────────

  @Cron('0 * * * * *')
  async remind() {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { dispatchDevices: { some: { isActive: true } } },
        select: { id: true, settings: true },
      });
      for (const t of tenants) {
        const cfg = courierSettings(t.settings);
        const stale = await this.prisma.courierCashEntry.findMany({
          where: {
            tenantId: t.id,
            type: 'HANDED_IN',
            status: 'PENDING',
            remindedAt: null,
            createdAt: { lt: new Date(Date.now() - cfg.cashConfirmRemindMin * 60_000) },
          },
          include: { courier: true },
        });
        for (const e of stale) {
          await this.prisma.courierCashEntry.update({ where: { id: e.id }, data: { remindedAt: new Date() } });
          const amount = tenge(e.claimedAmount ?? -e.amount);
          if (e.cardChatId) {
            await this.telegram.call(t.id, 'sendMessage', {
              chat_id: e.cardChatId,
              text: `⏰ Сдача ${amount} от ${shortName(e.courier.fullName)} всё ещё не подтверждена.`,
              reply_to_message_id: e.cardMessageId ?? undefined,
              allow_sending_without_reply: true,
            });
          }
          await this.assignment.sendToCourier(
            t.id,
            e.courier.telegramUserId,
            `⏰ Кассир ещё не подтвердил ваши ${amount}. Напомните ей.`,
          );
        }
      }
    } catch (e) {
      this.logger.error(`Напоминания о наличке: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Раз в час проверяем, не пора ли отправить итог дня (час — в настройках) */
  @Cron('0 0 * * * *')
  async dailyReportTick(now = new Date()) {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { dispatchDevices: { some: { isActive: true } } },
        select: { id: true, settings: true },
      });
      for (const t of tenants) {
        if (now.getHours() !== courierSettings(t.settings).dailyReportHour) continue;
        const text = await this.dailyReport(t.id, now);
        if (!text) continue;
        await this.telegram.notifyCashier(t.id, text, undefined, { links: false });
        await this.telegram.notify(t.id, text);
      }
    } catch (e) {
      this.logger.error(`Итог дня по курьерам: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Ночное автозакрытие (24.11.2026). Пока часть доставок идёт из старого
   * приложения, курьеры часто уезжают домой, не закрыв смену, и утром
   * продолжают вчерашнюю — расчёт за два дня смешивается. В час
   * `shiftAutoCloseHour` открытые смены закрываются, расчёт уходит кассиру
   * с пометкой. Смену с заказом на руках не трогаем: закроется в следующий раз.
   */
  @Cron('0 1 * * * *')
  async autoCloseTick(now = new Date()) {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { dispatchDevices: { some: { isActive: true } } },
        select: { id: true, settings: true },
      });
      for (const t of tenants) {
        if (now.getHours() !== courierSettings(t.settings).shiftAutoCloseHour) continue;
        await this.autoCloseShifts(t.id, now);
      }
    } catch (e) {
      this.logger.error(`Автозакрытие смен: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async autoCloseShifts(tenantId: string, now = new Date()): Promise<number> {
    const shifts = await this.prisma.courierShift.findMany({
      where: {
        tenantId,
        endedAt: null,
        tasks: { none: { status: { in: ['ASSIGNED', 'PICKED_UP'] } } },
      },
      include: { courier: true },
    });
    let closed = 0;
    for (const s of shifts) {
      const changed = await this.prisma.courierShift.updateMany({
        where: { id: s.id, endedAt: null },
        data: { endedAt: now, endedBy: 'AUTO', state: 'AWAY', pauseUntil: null },
      });
      if (changed.count === 0) continue;
      closed++;
      await this.prisma.courier.update({
        where: { id: s.courierId },
        data: { completedShifts: { increment: 1 } },
      });
      await this.prisma.deliveryTaskEvent.create({
        data: { tenantId, shiftId: s.id, courierId: s.courierId, type: 'SHIFT_END', actor: 'SYSTEM', meta: { auto: true } },
      });
      const settlement = await this.createSettlement(tenantId, s.courier, s.id, 'AUTO');
      if (!settlement) {
        await this.assignment.sendToCourier(
          tenantId,
          s.courier.telegramUserId,
          '🏁 Вы не закрыли смену — система закрыла её сама. Рассчитываться не за что.',
        );
      }
    }
    if (closed > 0) this.logger.log(`Автозакрытие: закрыто смен ${closed}`);
    return closed;
  }

  async dailyReport(tenantId: string, now = new Date()): Promise<string | null> {
    const since = new Date(now);
    since.setHours(0, 0, 0, 0);
    const couriers = await this.prisma.courier.findMany({
      where: {
        tenantId,
        OR: [
          { shifts: { some: { startedAt: { gte: since } } } },
          { payoutLines: { some: { settledAt: null } } },
        ],
      },
      orderBy: { fullName: 'asc' },
    });
    if (couriers.length === 0) return null;

    const rows: string[] = [];
    let totalDeliveries = 0;
    for (const c of couriers) {
      const [today, open, held, settlement] = await Promise.all([
        this.prisma.courierPayoutLine.count({
          where: { courierId: c.id, createdAt: { gte: since }, type: { in: ['DELIVERY', 'EXTRA_TRIP'] } },
        }),
        this.unsettled(c.id),
        this.balance(c.id),
        this.prisma.courierSettlement.findFirst({
          where: { courierId: c.id, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      totalDeliveries += today;
      const state = settlement
        ? { PENDING: 'расчёт ждёт кассира', CONFIRMED: 'рассчитались', DISPUTED: 'расчёт не сошёлся' }[settlement.status]
        : 'смену не закрыл (закроется ночью сама)';
      const owed = open.earned > 0 || held > 0
        ? ` · не выплачено ${tenge(open.earned)}, на руках ${tenge(held)}`
        : '';
      rows.push(`• <b>${esc(shortName(c.fullName))}</b>: ${today} дост.${owed} — ${state}`);
    }
    // Довозы — отдельной строкой: по ним видно, кто ошибается при сборке
    const extra = await this.prisma.deliveryTask.findMany({
      where: { tenantId, kind: 'EXTRA_TRIP', createdAt: { gte: since }, status: { not: 'CANCELLED' } },
      select: { extraReason: true, external: true, order: { select: { number: true } } },
    });
    const extraLine = extra.length
      ? `\n\n↩️ Довозов: ${extra.length}\n` +
        extra.map((e) => `• №${orderOf(e).number}: ${esc(e.extraReason ?? '')}`).join('\n')
      : '';
    return `📊 <b>Курьеры за день</b> · доставок ${totalDeliveries}\n${rows.join('\n')}${extraLine}`;
  }

  // ─── Вспомогательное ───────────────────────────────────────────

  /** Убрать кнопки с карточки и дописать итог */
  private async closeCard(
    tenantId: string,
    chatId: string | null,
    messageId: number | null,
    verdict: string,
  ) {
    if (!chatId || !messageId) return;
    await this.telegram.call(tenantId, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
    await this.telegram.call(tenantId, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: verdict,
      reply_to_message_id: messageId,
      allow_sending_without_reply: true,
    });
  }
}
