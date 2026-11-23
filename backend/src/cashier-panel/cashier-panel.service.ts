import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { OrderingService } from '../availability/ordering.service';
import { RushService } from '../availability/rush.service';
import { StopListService } from '../stoplist/stoplist.service';
import { esc, InlineButton, TelegramService } from '../telegram/telegram.service';
import { TelegramUpdatesService } from '../telegram/telegram-updates.service';
import { TgCallbackQuery, TgMessage, TgUpdate, TgUser } from '../telegram/telegram.types';
import type { StopPreset } from '../stoplist/stop-deadline';
import {
  categoryMenu,
  durationMenu,
  hhmm,
  KEY,
  orderingMenu,
  PanelState,
  panelKeyboard,
  panelText,
  replyKeyboard,
  rushMenu,
  searchProducts,
  searchResults,
  STOP_CHOICES,
  stopQuery,
  StopRow,
  stopsMenu,
} from './panel-view';

function nameOf(u?: TgUser) {
  if (!u) return 'Кассир';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : 'Кассир');
}

interface Ctx {
  tenantId: string;
  settings: Record<string, any>;
  chatId: string;
  tz: string;
}

/**
 * Пульт кассы в группе кассиров (DECISIONS §12.x, «касса в Телеграме»).
 *
 * Закреплённое сообщение со статусом: приём заказов, высокий спрос,
 * стоп-лист. Бот сам переписывает его, когда что-то меняется — кнопкой,
 * из админки или по истечении срока. Действия открываются отдельным
 * сообщением-меню, а после действия оно превращается в запись «кто что
 * сделал» — это и есть журнал смены в группе.
 *
 * Те же меню открываются кнопками у поля ввода (значок с квадратиками) и
 * текстом «стоп пепперони». Для этого бот должен быть администратором
 * группы: иначе Телеграм не присылает ему обычные сообщения и не даёт
 * закреплять и удалять.
 */
@Injectable()
export class CashierPanelService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(CashierPanelService.name);
  /** Последний текст пульта: правим сообщение, только если он изменился */
  private readonly rendered = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly updates: TelegramUpdatesService,
    private readonly availability: AvailabilityService,
    private readonly ordering: OrderingService,
    private readonly rush: RushService,
    private readonly stops: StopListService,
  ) {}

  onModuleInit() {
    this.updates.register((tenantId, update) => this.handle(tenantId, update));
  }

  /** Команды в меню «/» — только в группе кассиров и только в бою */
  async onApplicationBootstrap() {
    if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production') return;
    void this.registerCommands().catch((e) => this.logger.warn(`Команды пульта не заданы: ${e}`));
  }

  private async registerCommands() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, settings: true } });
    for (const t of tenants) {
      const chatId = (t.settings as any)?.telegram?.cashierChatId;
      if (!chatId) continue;
      await this.telegram.call(t.id, 'setMyCommands', {
        scope: { type: 'chat', chat_id: chatId },
        commands: [
          { command: 'pult', description: 'Пульт кассы: приём заказов, спрос, стоп-лист' },
          { command: 'knopki', description: 'Показать кнопки пульта у поля ввода' },
        ],
      });
    }
  }

  private async ctx(tenantId: string): Promise<Ctx | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const settings = (tenant?.settings as Record<string, any>) ?? {};
    const chatId = String(settings.telegram?.cashierChatId ?? '');
    if (!chatId) return null;
    return { tenantId, settings, chatId, tz: settings.timezone ?? 'Asia/Almaty' };
  }

  async state(c: Ctx, now = new Date()): Promise<PanelState> {
    const a = this.availability.getState(c.settings, now);
    const active = await this.stops.active(c.tenantId, now);
    return {
      mode: a.mode,
      orderingUntil: a.orderingUntil,
      rushExtraMinutes: a.rushExtraMinutes,
      rushUntil: a.rushUntil,
      stops: [
        ...active.categories.map((x) => ({ name: `Категория «${x.name}»`, until: x.until as Date })),
        ...active.products.map((x) => ({ name: x.name, until: x.until as Date })),
      ],
    };
  }

  // ─── Входящие апдейты ─────────────────────────────────────────

  async handle(tenantId: string, update: TgUpdate): Promise<boolean> {
    const q = update.callback_query;
    if (q?.data?.startsWith('p:')) {
      await this.onButton(tenantId, q);
      return true;
    }
    const m = update.message;
    if (m?.text) return this.onText(tenantId, m);
    return false;
  }

  private async onText(tenantId: string, m: TgMessage): Promise<boolean> {
    const text = m.text!.trim();
    const command = /^\/(pult|knopki)(@\w+)?$/i.exec(text)?.[1]?.toLowerCase();
    const key = Object.values(KEY).find((k) => k === text);
    // Ответ на сообщение (клиенту, курьеру) — не команда пульта, даже если начат со «стоп»
    const query = m.reply_to_message ? null : stopQuery(text);
    if (!command && !key && !query) return false;

    const c = await this.ctx(tenantId);
    // Только в группе кассиров: в личке и чужих чатах пульта нет
    if (!c || String(m.chat.id) !== c.chatId) return false;

    // Нажатие кнопки у поля ввода приходит сообщением от кассира — оно
    // засоряет ленту, убираем (если бот администратор)
    if (key || command) {
      await this.telegram.call(tenantId, 'deleteMessage', { chat_id: c.chatId, message_id: m.message_id });
    }

    if (command === 'knopki') {
      await this.send(c, 'Кнопки пульта — под значком с квадратиками у поля ввода.', replyKeyboard);
      return true;
    }
    if (command === 'pult' || key === KEY.panel) {
      await this.postPanel(c);
      return true;
    }
    const s = await this.state(c);
    if (key === KEY.ordering) await this.sendMenu(c, orderingMenu(s, c.tz));
    else if (key === KEY.rush) await this.sendMenu(c, rushMenu(s, c.tz));
    else if (key === KEY.stops) await this.sendMenu(c, await this.stopsView(c));
    else if (query) {
      const products = await this.sellable(tenantId);
      await this.sendMenu(c, searchResults(query, searchProducts(query, products)), m.message_id);
    }
    return true;
  }

  private async onButton(tenantId: string, q: TgCallbackQuery) {
    const toast = (text = '', alert = false) =>
      this.telegram.call(tenantId, 'answerCallbackQuery', {
        callback_query_id: q.id,
        text: text.slice(0, 200),
        show_alert: alert,
      });
    const c = await this.ctx(tenantId);
    const msg = q.message;
    if (!c || !msg || String(msg.chat.id) !== c.chatId) {
      return toast('Пульт работает только в группе кассиров', true);
    }
    const who = nameOf(q.from);
    const [, step, arg, extra] = (q.data ?? '').split(':');
    const edit = (view: { text: string; keyboard: InlineButton[][] }) =>
      this.telegram.call(tenantId, 'editMessageText', {
        chat_id: c.chatId,
        message_id: msg.message_id,
        parse_mode: 'HTML',
        text: view.text,
        reply_markup: { inline_keyboard: view.keyboard },
      });
    /** Итог действия: меню становится записью в журнале смены */
    const done = async (text: string) => {
      await edit({ text: `${text}\n👤 ${who}`, keyboard: [] });
      await this.refresh(tenantId);
    };
    const panelPressed = msg.message_id === Number(c.settings.cashierPanel?.messageId);

    try {
      const s = await this.state(c);
      switch (step) {
        case 'close':
          await this.telegram.call(tenantId, 'deleteMessage', { chat_id: c.chatId, message_id: msg.message_id });
          return toast();
        // Кнопки самого пульта открывают меню отдельным сообщением:
        // закреп остаётся статусом и не превращается в меню
        case 'o':
          if (panelPressed) await this.sendMenu(c, orderingMenu(s, c.tz));
          else await edit(orderingMenu(s, c.tz));
          return toast();
        case 'r':
          if (panelPressed) await this.sendMenu(c, rushMenu(s, c.tz));
          else await edit(rushMenu(s, c.tz));
          return toast();
        case 's': {
          const view = await this.stopsView(c);
          if (panelPressed) await this.sendMenu(c, view);
          else await edit(view);
          return toast();
        }
        case 'oa':
          await this.ordering.setTemporary(tenantId, 'ALL', undefined, '', who);
          await done('✅ <b>Приём заказов возобновлён</b>');
          return toast('Приём возобновлён');
        case 'op':
        case 'oc': {
          const minutes = Number(arg);
          const mode = step === 'op' ? 'PICKUP_ONLY' : 'CLOSED';
          await this.ordering.setTemporary(tenantId, mode, minutes, '', who);
          const until = hhmm(new Date(Date.now() + minutes * 60_000), c.tz);
          await done(
            mode === 'CLOSED'
              ? `🛑 <b>Приём заказов остановлен до ${until}</b>`
              : `🚗 <b>Доставка остановлена до ${until}</b>, самовывоз работает`,
          );
          return toast('Готово');
        }
        case 'rs': {
          const extraMin = Number(arg);
          await this.rush.set(extraMin, new Date(), who);
          await done(
            extraMin > 0
              ? `🔥 <b>Высокий спрос: +${extraMin} мин</b> до ${hhmm(new Date(Date.now() + 3_600_000), c.tz)}`
              : '🔻 <b>Высокий спрос снят</b>',
          );
          return toast('Готово');
        }
        case 'sc': {
          const category = await this.prisma.appCategory.findFirst({
            where: { id: arg, tenantId },
            select: { id: true, name: true },
          });
          if (!category) return toast('Категория не найдена', true);
          const products = (await this.sellable(tenantId)).filter((p) => p.categoryId === category.id);
          await edit(categoryMenu(category, products, Number(extra) || 0));
          return toast();
        }
        case 'sp': {
          const p = (await this.sellable(tenantId)).find((x) => x.id === arg);
          if (!p) return toast('Товар не найден', true);
          await edit(durationMenu('p', p.id, p.name, `p:sc:${p.categoryId}:0`));
          return toast();
        }
        case 'sk': {
          const cat = await this.prisma.appCategory.findFirst({ where: { id: arg, tenantId }, select: { name: true } });
          if (!cat) return toast('Категория не найдена', true);
          await edit(durationMenu('k', arg, `Вся категория «${cat.name}»`, `p:sc:${arg}:0`));
          return toast();
        }
        case 'py':
        case 'ky': {
          const choice = STOP_CHOICES.find((x) => x.code === extra);
          if (!choice) return toast('Не получилось', true);
          const target = step === 'py' ? { productId: arg } : { appCategoryId: arg };
          const r = await this.stops.stop(tenantId, target, choice.preset as StopPreset, '', new Date(), who);
          await done(
            `⛔️ <b>${step === 'ky' ? `Категория «${esc(r.name)}»` : `«${esc(r.name)}»`}</b> на стопе до ${hhmm(r.until, c.tz)}`,
          );
          return toast('На стопе');
        }
        case 'up':
        case 'uc': {
          const target = step === 'up' ? { productId: arg } : { appCategoryId: arg };
          const name = await this.targetName(tenantId, target);
          await this.stops.release(tenantId, target);
          await done(`↩️ <b>${esc(name)}</b> снова в продаже`);
          return toast('Вернули в продажу');
        }
      }
      return toast('Кнопка устарела — откройте пульт заново', true);
    } catch (e) {
      const text = (e as any)?.response?.message ?? (e as Error)?.message ?? String(e);
      this.logger.warn(`Кнопка пульта ${q.data}: ${text}`);
      return toast(Array.isArray(text) ? text.join(', ') : String(text), true);
    }
  }

  // ─── Сообщения ────────────────────────────────────────────────

  private async send(c: Ctx, text: string, markup?: unknown, replyTo?: number) {
    const { result } = await this.telegram.call(c.tenantId, 'sendMessage', {
      chat_id: c.chatId,
      parse_mode: 'HTML',
      text,
      ...(markup ? { reply_markup: markup } : {}),
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    });
    return result?.message_id as number | undefined;
  }

  private sendMenu(c: Ctx, view: { text: string; keyboard: InlineButton[][] }, replyTo?: number) {
    return this.send(c, view.text, { inline_keyboard: view.keyboard }, replyTo);
  }

  /**
   * Новый пульт внизу ленты, закреплённый; старый удаляем. Так «Пульт»
   * у поля ввода всегда даёт свежий пульт под рукой, а закреп один.
   */
  async postPanel(c: Ctx) {
    const text = panelText(await this.state(c), c.tz);
    const messageId = await this.send(c, text, { inline_keyboard: panelKeyboard() });
    if (!messageId) return;
    const old = Number(c.settings.cashierPanel?.messageId) || 0;
    if (old && old !== messageId) {
      await this.telegram.call(c.tenantId, 'deleteMessage', { chat_id: c.chatId, message_id: old });
    }
    const pinned = await this.telegram.call(c.tenantId, 'pinChatMessage', {
      chat_id: c.chatId,
      message_id: messageId,
      disable_notification: true,
    });
    if (pinned.error) {
      await this.send(
        c,
        '📌 Не получилось закрепить пульт: сделайте бота администратором группы ' +
          '(права «Закреплять сообщения» и «Удалять сообщения») или закрепите вручную.',
      );
    }
    // Перечитываем настройки прямо перед записью: между чтением и
    // записью их могла поменять другая кнопка
    const fresh = await this.prisma.tenant.findUnique({ where: { id: c.tenantId }, select: { settings: true } });
    await this.prisma.tenant.update({
      where: { id: c.tenantId },
      data: {
        settings: {
          ...((fresh?.settings as Record<string, any>) ?? {}),
          cashierPanel: { chatId: c.chatId, messageId },
        },
      },
    });
    this.rendered.set(c.tenantId, text);
  }

  /** Переписать пульт, если изменилось состояние */
  async refresh(tenantId: string) {
    const c = await this.ctx(tenantId);
    const panel = c?.settings.cashierPanel;
    if (!c || !panel?.messageId || String(panel.chatId) !== c.chatId) return;
    const text = panelText(await this.state(c), c.tz);
    if (this.rendered.get(tenantId) === text) return;
    const { error } = await this.telegram.call(tenantId, 'editMessageText', {
      chat_id: c.chatId,
      message_id: panel.messageId,
      parse_mode: 'HTML',
      text,
      reply_markup: { inline_keyboard: panelKeyboard() },
    });
    if (!error || /not modified/i.test(error)) this.rendered.set(tenantId, text);
  }

  /**
   * Раз в минуту: сроки истекают сами, а приём и стоп могли поменять в
   * админке — пульт должен показывать правду без нажатий.
   */
  @Cron('*/1 * * * *')
  async refreshAll() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, settings: true } });
    for (const t of tenants) {
      if (!(t.settings as any)?.cashierPanel?.messageId) continue;
      await this.refresh(t.id).catch((e) => this.logger.warn(`Пульт не обновлён: ${e}`));
    }
  }

  // ─── Данные ───────────────────────────────────────────────────

  /** То, что клиент видит в меню, — только это и есть смысл ставить на стоп */
  async sellable(tenantId: string, now = new Date()) {
    const rows = await this.prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        isVisible: true,
        appCategoryId: { not: null },
        appCategory: { isVisible: true },
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        appCategoryId: true,
        stoppedUntil: true,
        sortOverride: true,
        sortOrder: true,
      },
      orderBy: [{ sortOverride: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.displayName ?? r.name,
      categoryId: r.appCategoryId as string,
      stopped: Boolean(r.stoppedUntil && r.stoppedUntil > now),
    }));
  }

  private async stopsView(c: Ctx) {
    const [active, categories] = await Promise.all([
      this.stops.active(c.tenantId),
      this.prisma.appCategory.findMany({
        where: { tenantId: c.tenantId, isVisible: true, products: { some: { isVisible: true, isActive: true } } },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const stopped: StopRow[] = [
      ...active.categories.map((x) => ({ id: x.id, name: `Категория «${x.name}»`, until: x.until as Date, kind: 'category' as const })),
      ...active.products.map((x) => ({ id: x.id, name: x.name, until: x.until as Date, kind: 'product' as const })),
    ];
    return stopsMenu(stopped, categories, c.tz);
  }

  private async targetName(tenantId: string, t: { productId?: string; appCategoryId?: string }) {
    if (t.productId) {
      const p = await this.prisma.product.findFirst({ where: { id: t.productId, tenantId }, select: { name: true, displayName: true } });
      return `«${p?.displayName ?? p?.name ?? 'Позиция'}»`;
    }
    const cat = await this.prisma.appCategory.findFirst({ where: { id: t.appCategoryId, tenantId }, select: { name: true } });
    return `Категория «${cat?.name ?? ''}»`;
  }
}
