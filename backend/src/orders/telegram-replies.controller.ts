import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { OrderMessagesService, QUICK_REPLIES } from './order-messages.service';

/**
 * Секрет вебхука выводим из токена бота, а не храним отдельно: его
 * знают только Телеграм и мы, а новая переменная окружения ради этого
 * не нужна. Сменили токен — сменился и секрет.
 */
export function webhookSecret(botToken: string, tenantId: string) {
  return createHash('sha256').update(`${tenantId}:${botToken}`).digest('hex').slice(0, 48);
}

/** Имя нажавшего — так его и запишем в ответе: «Альбина» */
function whoOf(from: TgUser | undefined) {
  if (!from) return 'Кассир';
  return [from.first_name, from.last_name].filter(Boolean).join(' ') ||
    (from.username ? `@${from.username}` : 'Кассир');
}

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  title?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: { message_id: number };
}
interface TgUpdate {
  callback_query?: {
    id: string;
    from: TgUser;
    data?: string;
    message?: TgMessage;
  };
  message?: TgMessage;
}

/**
 * Ответы кассира клиенту из группы Телеграма.
 *
 * Кассир нажимает готовый ответ под вопросом клиента — или «Свой ответ»
 * и пишет текст ответом на подсказку. Клиенту уходит пуш, а вопрос в
 * группе переписывается вместе с ответом и именем ответившего.
 */
@Injectable()
export class TelegramRepliesService {
  private readonly logger = new Logger(TelegramRepliesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly messages: OrderMessagesService,
  ) {}

  async handle(tenantId: string, update: TgUpdate) {
    if (update.callback_query) return this.onButton(tenantId, update.callback_query);
    if (update.message) return this.onMessage(tenantId, update.message);
  }

  private async onButton(
    tenantId: string,
    q: NonNullable<TgUpdate['callback_query']>,
  ) {
    const reply = (text: string) =>
      this.telegram.call(tenantId, 'answerCallbackQuery', {
        callback_query_id: q.id,
        text,
      });

    const [kind, messageId, index] = (q.data ?? '').split(':');
    const message = messageId
      ? await this.prisma.orderMessage.findFirst({
          where: { id: messageId, order: { tenantId } },
          select: {
            id: true,
            topic: true,
            answeredAt: true,
            answeredBy: true,
            telegramChatId: true,
            telegramMessageId: true,
            order: { select: { number: true } },
          },
        })
      : null;
    if (!message) return reply('Сообщение не найдено');
    if (message.answeredAt) {
      return reply(`Уже ответили${message.answeredBy ? `: ${message.answeredBy}` : ''}`);
    }

    if (kind === 'r') {
      const text = (QUICK_REPLIES[message.topic] ?? QUICK_REPLIES.OTHER)[Number(index)];
      if (!text) return reply('Нет такого ответа');
      const result = await this.messages.answer(message.id, text, whoOf(q.from));
      return reply(result.ok ? 'Ответ отправлен клиенту' : (result.reason ?? 'Не получилось'));
    }

    if (kind === 'c' && message.telegramChatId) {
      // Подсказка с упоминанием нажавшего: force_reply с selective
      // открывает поле ответа только у него, а не у всей группы.
      const mention = `<a href="tg://user?id=${q.from.id}">${esc(whoOf(q.from))}</a>`;
      const { result } = await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: message.telegramChatId,
        parse_mode: 'HTML',
        text: `✍️ ${mention}, напишите ответ клиенту по заказу №${message.order.number} — ответом на это сообщение`,
        reply_to_message_id: message.telegramMessageId ?? undefined,
        allow_sending_without_reply: true,
        reply_markup: { force_reply: true, selective: true },
      });
      if (result?.message_id) {
        await this.prisma.orderMessage.update({
          where: { id: message.id },
          data: { replyPromptMessageId: result.message_id },
        });
      }
      return reply('Напишите ответ в группе');
    }
    return reply('Не получилось');
  }

  private async onMessage(tenantId: string, m: TgMessage) {
    this.telegram.rememberChat(tenantId, m.chat);
    const repliedTo = m.reply_to_message?.message_id;
    if (!repliedTo || !m.text?.trim()) return;

    const chatId = String(m.chat.id);
    // Ответом считаем и ответ на подсказку «Свой ответ», и прямой
    // ответ на сам вопрос клиента — кассир сделает так или иначе.
    const message = await this.prisma.orderMessage.findFirst({
      where: {
        order: { tenantId },
        telegramChatId: chatId,
        OR: [
          { replyPromptMessageId: repliedTo },
          { telegramMessageId: repliedTo },
        ],
      },
      select: { id: true, answeredAt: true, replyPromptMessageId: true },
    });
    if (!message) return;

    if (message.answeredAt) {
      await this.telegram.call(tenantId, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: m.message_id,
        text: 'На этот вопрос уже ответили — клиенту ушёл первый ответ.',
      });
      return;
    }

    const result = await this.messages.answer(message.id, m.text, whoOf(m.from));
    if (result.ok && message.replyPromptMessageId) {
      // Подсказка своё отслужила: ответ уже вписан в вопрос
      await this.telegram.call(tenantId, 'deleteMessage', {
        chat_id: chatId,
        message_id: message.replyPromptMessageId,
      });
    }
    await this.telegram.call(tenantId, 'setMessageReaction', {
      chat_id: chatId,
      message_id: m.message_id,
      reaction: [{ type: 'emoji', emoji: result.ok ? '👍' : '🤷' }],
    });
  }
}

@SkipThrottle()
@Controller('telegram')
export class TelegramRepliesController {
  private readonly logger = new Logger(TelegramRepliesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly replies: TelegramRepliesService,
  ) {}

  @Post('webhook/:tenantSlug')
  @HttpCode(200)
  async webhook(
    @Param('tenantSlug') slug: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TgUpdate,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, settings: true },
    });
    if (!tenant) throw new NotFoundException();
    const token = String(
      ((tenant.settings as Record<string, any>) ?? {}).telegram?.botToken ?? '',
    );
    if (!token || secret !== webhookSecret(token, tenant.id)) {
      throw new ForbiddenException();
    }
    try {
      await this.replies.handle(tenant.id, update);
    } catch (e) {
      // Телеграм повторяет апдейт, пока не получит 200, — ошибку
      // логируем, но отвечаем «принято», иначе одно нажатие придёт снова
      this.logger.warn(`Апдейт Телеграма не обработан: ${e}`);
    }
    return { ok: true };
  }
}

/**
 * Подключает вебхук при старте боевого сервера.
 *
 * Только в production: у теста может быть тот же бот, и тестовый сервер
 * перехватил бы у боевого нажатия кнопок. Адрес — публичный домен
 * Railway, его Railway передаёт сам.
 */
@Injectable()
export class TelegramWebhookBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramWebhookBootstrap.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async onApplicationBootstrap() {
    const env = process.env.RAILWAY_ENVIRONMENT_NAME;
    const base =
      process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : '');
    if (env !== 'production' || !base) return;
    // Не мешаем старту: сервер нужен и без кнопок в Телеграме
    void this.connectAll(base).catch((e) =>
      this.logger.warn(`Вебхук Телеграма не подключён: ${e}`),
    );
  }

  private async connectAll(base: string) {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, slug: true, settings: true },
    });
    for (const t of tenants) {
      const tg = ((t.settings as Record<string, any>) ?? {}).telegram ?? {};
      if (tg.enabled !== true || !tg.botToken) continue;
      const { error } = await this.telegram.connectWebhook(
        t.id,
        `${base.replace(/\/$/, '')}/telegram/webhook/${t.slug}`,
        webhookSecret(String(tg.botToken), t.id),
      );
      this.logger.log(
        error
          ? `Вебхук Телеграма для ${t.slug} не подключён: ${error}`
          : `Вебхук Телеграма для ${t.slug} подключён`,
      );
    }
  }
}
