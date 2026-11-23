import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Courier, Prisma } from '@prisma/client';
import { normalizeKzPhone } from '../common/phone';
import { PrismaService } from '../prisma/prisma.service';
import { esc as escapeHtml, TelegramService } from '../telegram/telegram.service';
import { TelegramUpdatesService } from '../telegram/telegram-updates.service';
import { TgCallbackQuery, TgMessage, TgUpdate, tgUserLabel } from '../telegram/telegram.types';
import { courierAppUrl } from './assignment.service';

/**
 * Регистрация курьера в боте (docs/COURIER_SYSTEM_SPEC.md §3).
 *
 * Шаги: согласие → ФИО → телефон кнопкой «Поделиться контактом» → селфи.
 * После селфи заявка уходит карточкой в чат кассы. Кассир подтверждает её,
 * когда курьер приезжает и показывает удостоверение.
 *
 * Состояние диалога хранится в самой строке курьера (DRAFT +
 * registrationStep), а не в памяти: перезапуск контейнера не должен
 * терять наполовину заполненную анкету.
 */

export const COURIER_START_PAYLOAD = 'courier';
const CB_CONSENT = 'courier:consent';
const CB_APPROVE = 'courier:approve:';
const CB_REJECT = 'courier:reject:';

type Step = 'CONSENT' | 'NAME' | 'PHONE' | 'SELFIE';

/** 2–4 слова из букв (дефис и апостроф внутри допустимы), до 100 символов */
const FULL_NAME = /^\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*){1,3}$/u;

const TEXT = {
  consent: (brand: string) =>
    `Здравствуйте! Это регистрация курьеров ${brand}.\n\n` +
    'Для работы понадобятся ФИО, номер телефона и селфи. Они нужны только ' +
    'для работы с заказами и расчётов и посторонним не передаются. Имя и ' +
    'селфи видны кассиру и курьерам на смене — в очереди у раздачи.\n\n' +
    'Нажмите «Согласен», чтобы продолжить.',
  askName: 'Напишите фамилию, имя и отчество полностью, как в удостоверении.',
  badName:
    'Не похоже на ФИО. Напишите фамилию, имя и отчество, например: Иванов Иван Иванович.',
  askPhone: 'Отправьте свой номер телефона кнопкой «📱 Отправить номер» внизу.',
  foreignPhone:
    'Нужен ваш собственный номер. Нажмите кнопку «📱 Отправить номер» внизу.',
  badPhone:
    'Номер должен быть казахстанским (+7). Если у вас другой номер, обратитесь к кассиру.',
  phoneTaken:
    'Этот номер уже зарегистрирован у другого курьера. Обратитесь к кассиру.',
  askSelfie:
    'Пришлите селфи: фото лица. По нему кассир узнает вас при первом ' +
    'приезде, а курьеры на смене увидят в очереди.',
  badSelfie: 'Нужна фотография. Пришлите селфи обычным фото, не файлом.',
  done:
    'Готово, заявка отправлена.\n\n' +
    'В первый приезд возьмите удостоверение личности: кассир сверит ФИО и ' +
    'подтвердит вас. После этого здесь появится доступ к сменам и заказам.',
  pending:
    'Ваша заявка ждёт проверки. В первый приезд возьмите удостоверение: ' +
    'кассир сверит ФИО и подтвердит вас.',
  active:
    'Вы курьер. Нажмите «Открыть», чтобы отметиться у раздачи и получать заказы.',
  rejected: 'Регистрация отклонена. Если это ошибка, обратитесь к кассиру.',
  disabled: 'Доступ отключён. Если это ошибка, обратитесь к администратору.',
  notCourier:
    'Это служебный бот. Курьеры регистрируются по ссылке от администратора.',
  approved: (brand: string) =>
    `Вы подтверждены как курьер ${brand}.\n\n` +
    'Как работать: у раздачи нажмите «Открыть» → «Я на месте» и отсканируйте QR на ' +
    'планшете. Заказ придёт сам. Получили пакет — «Забрал» со сканом QR, тогда ' +
    'появится адрес. Отдали клиенту — «Доставлен». Вернулись — снова «Я на месте».',
};

@Injectable()
export class CourierRegistrationService implements OnModuleInit {
  private readonly logger = new Logger(CourierRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly updates: TelegramUpdatesService,
  ) {}

  onModuleInit() {
    this.updates.register((tenantId, update) => this.handle(tenantId, update));
  }

  async handle(tenantId: string, update: TgUpdate): Promise<boolean> {
    if (update.callback_query) return this.onCallback(tenantId, update.callback_query);
    const msg = update.message;
    if (!msg?.from || msg.chat.type !== 'private') return false;
    return this.onPrivateMessage(tenantId, msg);
  }

  // ─── Личные сообщения ──────────────────────────────────────────

  private async onPrivateMessage(tenantId: string, msg: TgMessage): Promise<boolean> {
    const tgId = String(msg.from!.id);
    const courier = await this.findByTelegram(tenantId, tgId);
    const text = msg.text?.trim() ?? '';

    if (text.startsWith('/start')) {
      const payload = text.split(/\s+/)[1] ?? '';
      if (courier) {
        await this.resumeOrShowStatus(tenantId, courier);
      } else if (payload === COURIER_START_PAYLOAD) {
        await this.begin(tenantId, tgId);
      } else {
        await this.send(tenantId, tgId, TEXT.notCourier);
      }
      return true;
    }

    // Чужие сообщения и сообщения уже зарегистрированных — не наши
    if (!courier || courier.status !== 'DRAFT') return false;

    switch (courier.registrationStep as Step | null) {
      case 'NAME':
        await this.onName(tenantId, courier, text);
        break;
      case 'PHONE':
        await this.onPhone(tenantId, courier, msg);
        break;
      case 'SELFIE':
        await this.onSelfie(tenantId, courier, msg);
        break;
      default:
        await this.askConsent(tenantId, tgId);
    }
    return true;
  }

  private async begin(tenantId: string, tgId: string) {
    try {
      await this.prisma.courier.create({
        data: { tenantId, telegramUserId: tgId, status: 'DRAFT', registrationStep: 'CONSENT' },
      });
    } catch (e) {
      // Двойной /start: строка уже создана параллельным запросом
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    await this.askConsent(tenantId, tgId);
  }

  private async resumeOrShowStatus(tenantId: string, courier: Courier) {
    const chat = courier.telegramUserId;
    switch (courier.status) {
      case 'DRAFT':
        return this.askStep(tenantId, chat, (courier.registrationStep ?? 'CONSENT') as Step);
      case 'PENDING':
        return this.send(tenantId, chat, TEXT.pending);
      case 'ACTIVE':
        return this.send(tenantId, chat, TEXT.active, await this.appButton(tenantId));
      case 'REJECTED':
        return this.send(tenantId, chat, TEXT.rejected);
      case 'DISABLED':
        return this.send(tenantId, chat, TEXT.disabled);
    }
  }

  private async askStep(tenantId: string, chat: string, step: Step) {
    switch (step) {
      case 'CONSENT':
        return this.askConsent(tenantId, chat);
      case 'NAME':
        return this.send(tenantId, chat, TEXT.askName);
      case 'PHONE':
        return this.askPhone(tenantId, chat);
      case 'SELFIE':
        return this.send(tenantId, chat, TEXT.askSelfie, { remove_keyboard: true });
    }
  }

  private async askConsent(tenantId: string, chat: string) {
    await this.send(tenantId, chat, TEXT.consent(await this.brand(tenantId)), {
      inline_keyboard: [[{ text: 'Согласен', callback_data: CB_CONSENT }]],
    });
  }

  private async askPhone(tenantId: string, chat: string, text = TEXT.askPhone) {
    await this.send(tenantId, chat, text, {
      keyboard: [[{ text: '📱 Отправить номер', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  }

  private async onName(tenantId: string, courier: Courier, raw: string) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length > 100 || !FULL_NAME.test(name)) {
      return this.send(tenantId, courier.telegramUserId, TEXT.badName);
    }
    await this.prisma.courier.update({
      where: { id: courier.id },
      data: { fullName: name, registrationStep: 'PHONE' },
    });
    await this.askPhone(tenantId, courier.telegramUserId);
  }

  private async onPhone(tenantId: string, courier: Courier, msg: TgMessage) {
    const chat = courier.telegramUserId;
    // Контакт засчитываем, только если это номер самого отправителя:
    // так телефон гарантированно принадлежит этому Telegram-аккаунту
    if (!msg.contact || String(msg.contact.user_id ?? '') !== chat) {
      return this.askPhone(tenantId, chat, TEXT.foreignPhone);
    }
    let phone: string;
    try {
      phone = normalizeKzPhone(msg.contact.phone_number);
    } catch {
      return this.send(tenantId, chat, TEXT.badPhone, { remove_keyboard: true });
    }
    const taken = await this.prisma.courier.findFirst({
      where: { tenantId, phone, NOT: { id: courier.id } },
      select: { id: true },
    });
    if (taken) return this.send(tenantId, chat, TEXT.phoneTaken, { remove_keyboard: true });

    await this.prisma.courier.update({
      where: { id: courier.id },
      data: { phone, registrationStep: 'SELFIE' },
    });
    await this.send(tenantId, chat, TEXT.askSelfie, { remove_keyboard: true });
  }

  private async onSelfie(tenantId: string, courier: Courier, msg: TgMessage) {
    const chat = courier.telegramUserId;
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) return this.send(tenantId, chat, TEXT.badSelfie);

    const updated = await this.prisma.courier.update({
      where: { id: courier.id },
      data: { selfieFileId: photo.file_id, status: 'PENDING', registrationStep: null },
    });
    await this.send(tenantId, chat, TEXT.done);
    await this.sendApprovalCard(tenantId, updated);
  }

  // ─── Карточка для кассы ────────────────────────────────────────

  /**
   * Отправляется сразу после регистрации. Позже, при первом скане QR,
   * её же продублируем на планшет (этап 7.1, раздача).
   */
  async sendApprovalCard(
    tenantId: string,
    courier: Courier,
    opts: { atCounter?: boolean } = {},
  ) {
    const chat = await this.telegram.cashierTargetChat(tenantId);
    if (!chat) {
      this.logger.warn(`Курьер ${courier.id} зарегистрирован, но чат кассы не задан`);
      return;
    }
    const caption =
      '🛵 <b>Новый курьер</b>\n' +
      `${escapeHtml(courier.fullName)}\n${escapeHtml(courier.phone ?? '')}\n\n` +
      (opts.atCounter
        ? '📍 <b>Курьер сейчас у раздачи.</b> Сверьте удостоверение (ФИО должно совпасть) и подтвердите.'
        : 'Подтвердите, когда курьер приедет и покажет удостоверение. ФИО должно совпасть.');
    const reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ Подтвердить', callback_data: `${CB_APPROVE}${courier.id}` },
          { text: '✖ Отклонить', callback_data: `${CB_REJECT}${courier.id}` },
        ],
      ],
    };
    try {
      if (courier.selfieFileId) {
        await this.tg(tenantId, 'sendPhoto', {
          chat_id: chat,
          photo: courier.selfieFileId,
          caption,
          parse_mode: 'HTML',
          reply_markup,
        });
      } else {
        await this.tg(tenantId, 'sendMessage', {
          chat_id: chat,
          text: caption,
          parse_mode: 'HTML',
          reply_markup,
        });
      }
    } catch (e) {
      // Заявка уже сохранена; кассир увидит её и в админке
      this.logger.warn(`Карточка курьера ${courier.id} не ушла: ${String(e)}`);
    }
  }

  // ─── Кнопки ────────────────────────────────────────────────────

  private async onCallback(tenantId: string, cb: TgCallbackQuery): Promise<boolean> {
    const data = cb.data ?? '';
    if (data === CB_CONSENT) {
      await this.onConsent(tenantId, cb);
      return true;
    }
    if (data.startsWith(CB_APPROVE)) {
      await this.onDecision(tenantId, cb, data.slice(CB_APPROVE.length), 'ACTIVE');
      return true;
    }
    if (data.startsWith(CB_REJECT)) {
      await this.onDecision(tenantId, cb, data.slice(CB_REJECT.length), 'REJECTED');
      return true;
    }
    return false;
  }

  private async onConsent(tenantId: string, cb: TgCallbackQuery) {
    const tgId = String(cb.from.id);
    const done = await this.prisma.courier.updateMany({
      where: { tenantId, telegramUserId: tgId, status: 'DRAFT', registrationStep: 'CONSENT' },
      data: { consentAt: new Date(), registrationStep: 'NAME' },
    });
    await this.answer(tenantId, cb.id);
    if (cb.message) {
      // Убираем кнопку, чтобы повторное нажатие не путало
      await this.telegram.call(tenantId, 'editMessageReplyMarkup', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }
    if (done.count > 0) await this.send(tenantId, tgId, TEXT.askName);
  }

  private async onDecision(
    tenantId: string,
    cb: TgCallbackQuery,
    courierId: string,
    next: 'ACTIVE' | 'REJECTED',
  ) {
    const chatId = String(cb.message?.chat.id ?? '');
    const staffChats = await this.telegram.staffChatIds(tenantId);
    if (!staffChats.includes(chatId)) {
      await this.answer(tenantId, cb.id, 'Нет доступа');
      return;
    }

    const actor = tgUserLabel(cb.from);
    const now = new Date();
    // Атомарно: из двух одновременных нажатий сработает одно
    const changed = await this.prisma.courier.updateMany({
      where: { id: courierId, tenantId, status: 'PENDING' },
      data:
        next === 'ACTIVE'
          ? { status: 'ACTIVE', approvedBy: actor, approvedAt: now }
          : { status: 'REJECTED', approvedBy: actor, approvedAt: now },
    });
    if (changed.count === 0) {
      await this.answer(tenantId, cb.id, 'Уже обработано');
      return;
    }

    const courier = await this.prisma.courier.findUniqueOrThrow({ where: { id: courierId } });
    await this.prisma.adminAuditLog.create({
      data: {
        tenantId,
        actorName: actor,
        actorRole: 'CASHIER',
        action: next === 'ACTIVE' ? 'COURIER_APPROVED' : 'COURIER_REJECTED',
        entityType: 'Courier',
        entityId: courierId,
        summary: `${next === 'ACTIVE' ? 'Подтверждён' : 'Отклонён'} курьер ${courier.fullName}`,
      },
    });

    await this.answer(tenantId, cb.id, next === 'ACTIVE' ? 'Подтверждено' : 'Отклонено');
    if (cb.message) {
      const verdict =
        next === 'ACTIVE'
          ? `✅ Подтвердил(а): ${escapeHtml(actor)}`
          : `✖ Отклонил(а): ${escapeHtml(actor)}`;
      const when = now.toLocaleString('ru-RU', {
        timeZone: 'Asia/Almaty',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const body =
        '🛵 <b>Курьер</b>\n' +
        `${escapeHtml(courier.fullName)}\n${escapeHtml(courier.phone ?? '')}\n\n` +
        `${verdict}, ${when}`;
      const isPhoto = (cb.message.photo?.length ?? 0) > 0;
      const { error } = await this.telegram.call(
        tenantId,
        isPhoto ? 'editMessageCaption' : 'editMessageText',
        {
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          ...(isPhoto ? { caption: body } : { text: body }),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        },
      );
      if (error) this.logger.warn(`Карточку не обновили: ${error}`);
    }

    if (next === 'ACTIVE') {
      await this.send(
        tenantId,
        courier.telegramUserId,
        TEXT.approved(await this.brand(tenantId)),
        await this.appButton(tenantId),
      );
      await this.setMenuButton(tenantId, courier.telegramUserId);
    } else {
      await this.send(tenantId, courier.telegramUserId, TEXT.rejected);
    }
  }

  // ─── Вспомогательное ───────────────────────────────────────────

  /** Кнопка «Открыть» с Mini App курьера; без адреса админки — без кнопки */
  private async appButton(tenantId: string) {
    const url = await this.appUrl(tenantId);
    return url ? { inline_keyboard: [[{ text: 'Открыть', web_app: { url } }]] } : undefined;
  }

  /** Та же кнопка постоянно в меню чата курьера */
  private async setMenuButton(tenantId: string, chatId: string) {
    const url = await this.appUrl(tenantId);
    if (!url) return;
    await this.telegram.call(tenantId, 'setChatMenuButton', {
      chat_id: chatId,
      menu_button: { type: 'web_app', text: 'Смена', web_app: { url } },
    });
  }

  private async appUrl(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    return tenant ? courierAppUrl(tenant.slug) : null;
  }

  private findByTelegram(tenantId: string, telegramUserId: string) {
    return this.prisma.courier.findUnique({
      where: { tenantId_telegramUserId: { tenantId, telegramUserId } },
    });
  }

  private async brand(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? '';
  }

  private async send(
    tenantId: string,
    chatId: string,
    text: string,
    reply_markup?: Record<string, unknown>,
  ) {
    await this.tg(tenantId, 'sendMessage', {
      chat_id: chatId,
      text,
      ...(reply_markup ? { reply_markup } : {}),
    });
  }

  /** Вызов, ошибка которого должна быть видна (сообщение не дошло) */
  private async tg(tenantId: string, method: string, payload: Record<string, unknown>) {
    const { error, result } = await this.telegram.call(tenantId, method, payload);
    if (error) throw new Error(`${method}: ${error}`);
    return result;
  }

  private async answer(tenantId: string, callbackId: string, text?: string) {
    await this.telegram.call(tenantId, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text } : {}),
    });
  }
}
