import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { esc, InlineButton, TelegramService } from '../telegram/telegram.service';
import {
  acceptedBanner,
  acceptKeyboard,
  actionsButton,
  cancelledBanner,
  confirmKeyboard,
  isAccepted,
  menuKeyboard,
  parseMask,
  PickItem,
  pickedIds,
  reasonsKeyboard,
  shortageKeyboard,
} from './order-keyboards';
import { CancelReasonsService } from './cancel-reasons.service';
import { newOrderMessage, OrdersService } from './orders.service';
import { ShortageService } from './shortage.service';

/**
 * Кнопки под сообщением о заказе в группе кассиров.
 *
 * Под заказом одна кнопка «⋯ Действия»: пока всё идёт нормально, лента
 * не загромождена. Нажали — в том же сообщении разворачиваются отмена и
 * «нет позиции»; новых сообщений не появляется. Каждый шаг — правка
 * кнопок этого же сообщения, назад можно вернуться на любом шаге.
 */

interface Press {
  id: string;
  from: { id: number; first_name?: string; last_name?: string; username?: string };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

/** Через сколько неподтверждённое «Принять заказ» сворачивается обратно */
export const ACCEPT_CONFIRM_MS = 30_000;

@Injectable()
export class OrderActionsService {
  private readonly logger = new Logger(OrderActionsService.name);
  /**
   * Сообщения, где сейчас висит «👉 Нажмите, чтобы принять»: ключ — чат и
   * сообщение, значение — метка нажатия. Любое другое нажатие в этом
   * сообщении метку снимает, и таймер ничего не трогает.
   */
  private readonly confirming = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly orders: OrdersService,
    private readonly shortage: ShortageService,
    private readonly cancelReasons: CancelReasonsService,
  ) {}

  async handle(tenantId: string, q: Press, who: string) {
    const toast = (text: string, alert = false) =>
      this.telegram.call(tenantId, 'answerCallbackQuery', {
        callback_query_id: q.id,
        text: text.slice(0, 200),
        show_alert: alert,
      });

    const [, step, orderId, arg] = (q.data ?? '').split(':');
    const msg = q.message;
    if (!orderId || !msg) return toast('Не получилось');
    const msgKey = `${msg.chat.id}:${msg.message_id}`;
    this.confirming.delete(msgKey);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { orderBy: { id: 'asc' } },
        customer: true,
        tenant: { select: { settings: true } },
        dispatches: { select: { status: true, posterOrderId: true } },
      },
    });
    if (!order) return toast('Заказ не найден');
    // Только из той группы, куда ушёл сам заказ: пересланное в другой
    // чат сообщение не должно отменять заказы
    if (order.cashierChatId && String(msg.chat.id) !== order.cashierChatId) {
      return toast('Эта кнопка работает только в группе кассиров', true);
    }

    const setKeyboard = (keyboard: InlineButton[][] | null) =>
      this.telegram.call(tenantId, 'editMessageReplyMarkup', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: { inline_keyboard: keyboard ?? [] },
      });

    if (order.status === 'CANCELLED') {
      await setKeyboard(null);
      return toast(`Заказ №${order.number} уже отменён`, true);
    }
    if (order.status === 'DELIVERED' && step !== 'x') {
      await setKeyboard(null);
      return toast(`Заказ №${order.number} уже выполнен`, true);
    }

    const accepted = isAccepted(order.status);
    const items: PickItem[] = order.items
      .filter((i) => !i.isGift)
      .map((i) => ({ id: i.id, name: i.name, qty: i.qty }));

    try {
      switch (step) {
        case 'm':
          await setKeyboard(menuKeyboard(order.id, accepted));
          return toast('');
        case 'x':
          await setKeyboard(actionsButton(order.id, accepted));
          return toast('');
        case 'i':
          return toast(`Заказ №${order.number} принят`);
        case 'a':
        case 'ay': {
          // Запасной путь, когда планшет без интернета: кассир принял и
          // распечатал, а Poster узнает об этом только при связи — у клиента
          // до 15 минут висело «Ждём подтверждения» (Дом, 26.11.2026)
          const refusal = acceptRefusal(order);
          if (refusal) {
            await setKeyboard(actionsButton(order.id, accepted));
            return toast(refusal, true);
          }
          if (step === 'a') {
            await setKeyboard(acceptKeyboard(order.id));
            // Не подтвердили — через 30 с кнопки сворачиваются обратно, и
            // без метки «✅ Принят» видно, что заказ ещё не принят. Иначе
            // «👉 Нажмите…» висит часами и выглядит как сделанное (№357).
            const mark = Date.now();
            this.confirming.set(msgKey, mark);
            setTimeout(() => {
              if (this.confirming.get(msgKey) !== mark) return;
              this.confirming.delete(msgKey);
              void this.collapseIfStillNew(tenantId, order.id, msg).catch((e) =>
                this.logger.warn(`Не свернули «Принять» у №${order.number}: ${e}`),
              );
            }, ACCEPT_CONFIRM_MS).unref?.();
            return toast('Заказ ещё НЕ принят — нажмите «👉 Нажмите, чтобы принять заказ»');
          }
          await this.orders.setStatus(order.id, 'ACCEPTED', tenantId);
          this.logger.log(`Заказ №${order.number} принят кнопкой в Телеграме: ${who}`);
          const tz = (order.tenant?.settings as any)?.timezone ?? 'Asia/Almaty';
          const live = order.items.filter((i) => !i.isUnavailable);
          await this.telegram.call(tenantId, 'editMessageText', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'HTML',
            text: `${acceptedBanner(who, new Date(), tz)}\n\n${newOrderMessage(order, live)}`,
            reply_markup: { inline_keyboard: actionsButton(order.id, true) },
          });
          return toast(`Заказ №${order.number} принят`);
        }
        case 'rs': {
          // Повтор отправки: dispatchToPoster шлёт только упавшие части
          if (!order.dispatches.some((d) => d.status === 'FAILED')) {
            await setKeyboard(actionsButton(order.id, accepted));
            return toast(`Заказ №${order.number} уже в Poster`, true);
          }
          await this.orders.dispatchToPoster(order.id);
          const after = await this.prisma.orderDispatch.findMany({
            where: { orderId: order.id },
            select: { status: true },
          });
          if (after.some((d) => d.status === 'FAILED')) {
            return toast('Снова не дошёл до Poster — пробейте вручную и нажмите «✍️ Пробили вручную»', true);
          }
          this.logger.log(`Заказ №${order.number} отправлен в Poster повторно: ${who}`);
          await setKeyboard(actionsButton(order.id, accepted));
          return toast(`Заказ №${order.number} ушёл в Poster — примите на планшете`, true);
        }
        case 'mn': {
          // Кассир пробил чек руками: заказ принят, повторно не отправляем
          if (!accepted) await this.orders.setStatus(order.id, 'ACCEPTED', tenantId);
          this.logger.log(`Заказ №${order.number} пробит в Poster вручную: ${who}`);
          await setKeyboard(actionsButton(order.id, true));
          return toast(`Заказ №${order.number} принят`);
        }
        case 'dv': {
          // Еду отдали, а в системе заказ так и не приняли: закрываем
          // выданным, без пушей — клиент давно поел
          if (order.status === 'NEW') {
            await this.orders.setStatus(order.id, 'ACCEPTED', tenantId, { notify: false });
          }
          await this.orders.setStatus(order.id, 'DELIVERED', tenantId, { notify: false });
          this.logger.log(`Заказ №${order.number} закрыт как выданный: ${who}`);
          const tz = (order.tenant?.settings as any)?.timezone ?? 'Asia/Almaty';
          const time = new Date().toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
          await this.telegram.call(tenantId, 'editMessageText', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'HTML',
            text: `✅ <b>Заказ №${order.number} закрыт как выданный</b> — ${esc(who)}, ${time}. Деньги не возвращали.`,
            reply_markup: { inline_keyboard: [] },
          });
          return toast(`Заказ №${order.number} закрыт`);
        }
        case 'c': {
          const reasons = await this.cancelReasons.list(tenantId);
          await setKeyboard(reasonsKeyboard(order.id, reasons));
          return toast('Выберите причину отмены');
        }
        case 'cr': {
          const label = await this.cancelReasons.resolve(tenantId, arg, false);
          const refunds =
            order.paymentMethod === 'KASPI_ONLINE' &&
            ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus);
          await setKeyboard(confirmKeyboard(order.id, arg, label, refunds));
          return toast('Подтвердите отмену');
        }
        case 'cy': {
          const label = await this.cancelReasons.resolve(tenantId, arg, false);
          await this.orders.cancelByOperator(order.id, tenantId, arg, undefined, new Date(), {
            mode: 'FULL',
          }, who);
          const tz = (order.tenant?.settings as any)?.timezone ?? 'Asia/Almaty';
          const live = order.items.filter((i) => !i.isUnavailable);
          await this.telegram.call(tenantId, 'editMessageText', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'HTML',
            text: `${cancelledBanner(who, new Date(), label, tz)}\n\n${newOrderMessage(order, live)}`,
            reply_markup: { inline_keyboard: [] },
          });
          return toast(`Заказ №${order.number} отменён`);
        }
        case 's': {
          if (items.length === 0) return toast('В заказе нет позиций');
          // Первое открытие — с уже отмеченными ранее позициями
          const mask =
            arg === ''
              ? items.reduce(
                  (m, it, i) =>
                    order.items.find((x) => x.id === it.id)?.isUnavailable ? m + 2 ** i : m,
                  0,
                )
              : parseMask(arg);
          await setKeyboard(shortageKeyboard(order.id, items, mask));
          return toast(arg === '' ? 'Отметьте, чего нет' : '');
        }
        case 'sy': {
          const ids = pickedIds(items, parseMask(arg));
          if (ids.length === 0) return toast('Ничего не отмечено', true);
          await this.shortage.markUnavailable(tenantId, order.id, ids, new Date(), who);
          await setKeyboard(actionsButton(order.id, accepted));
          return toast('Спросили клиента. Заказ в Poster пока не принимайте', true);
        }
      }
    } catch (e) {
      // Ошибки сервиса — понятные кассиру тексты («уже принял на
      // планшете…»): показываем окном, а не молча
      const text = (e as any)?.response?.message ?? (e as Error)?.message ?? String(e);
      this.logger.warn(`Кнопка ${q.data} по заказу №${order.number}: ${text}`);
      return toast(Array.isArray(text) ? text.join(', ') : String(text), true);
    }
    return toast('Не получилось');
  }

  /** «Принять» не подтвердили: сворачиваем кнопки, если заказ всё ещё новый */
  private async collapseIfStillNew(
    tenantId: string,
    orderId: string,
    msg: { message_id: number; chat: { id: number } },
  ) {
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (fresh?.status !== 'NEW') return;
    await this.telegram.call(tenantId, 'editMessageReplyMarkup', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: actionsButton(orderId, false) },
    });
  }
}

/** Почему «Принят» нажать нельзя; null — можно */
export function acceptRefusal(order: {
  number: number;
  status: string;
  shortageState?: string | null;
  dispatches: { status: string; posterOrderId: string | null }[];
}): string | null {
  if (order.status !== 'NEW') return `Заказ №${order.number} уже принят`;
  // FAILED — чек не дошёл до Poster, и кассир пробила его вручную (№357)
  if (!order.dispatches.some((d) => (d.status === 'SENT' && d.posterOrderId) || d.status === 'FAILED')) {
    return `Заказ №${order.number} ещё не ушёл на планшет: идёт окно отмены или ждём оплату`;
  }
  if (order.shortageState === 'AWAITING_CUSTOMER') {
    return `По заказу №${order.number} ждём ответ клиента о нехватке — принимать рано`;
  }
  return null;
}
