import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PosterClient } from '../poster/poster.client';
import { PrismaService } from '../prisma/prisma.service';
import { courierSettings } from './courier-settings';
import { externalOf, ExternalOrder } from './task-order';

/**
 * Заказы, пришедшие в Poster мимо нас, — на планшет раздачи (24.11.2026).
 *
 * Пока работают старое приложение и старый сайт, их доставки возят те же
 * курьеры. Без этого очередь у раздачи не знает, что курьер уехал с чужим
 * заказом, и порядок разваливается. Теперь такие заказы тоже становятся
 * плитками: раздача жмёт «Готов», заказ уходит первому в очереди.
 *
 * Что берём: онлайн-заказы Poster, которые кассир **принял** (статус 1),
 * доставка или самовывоз, за последние `posterImportWindowMin` минут.
 * Что не берём:
 * - наши заказы — их входящие номера записаны в OrderDispatch;
 * - Яндекс Еду — Order Bridge пишет в комментарий «Яндекс Еда №…»;
 * - Wolt — кассир пробивает его вручную, онлайн-заказом он не приходит.
 *
 * Общий заказ старое приложение делит на два чека — PizzBurg и Sunday,
 * с одним телефоном. Их склеиваем в одну плитку: тот же телефон, другой
 * аккаунт Poster, разница во времени не больше `MERGE_WINDOW_MS`.
 */

const MERGE_WINDOW_MS = 20 * 60_000;

type Raw = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Деньги Poster в сотых → целые ₸ */
const money = (v: unknown) => Math.round(num(v) / 100);

export function phoneKey(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/** «улица Казбека Нуралина, 53» → улица и дом; без запятой — весь текст улицей */
export function splitAddress(line: string): { street: string; house: string } {
  const text = line.trim();
  const m = text.match(/^(.*?)[,\s]+(?:д\.?\s*|дом\s+)?(\d+[\p{L}\d/-]*)\s*$/u);
  return m && m[1].trim() ? { street: m[1].trim().replace(/,$/, ''), house: m[2] } : { street: text, house: '' };
}

/** Адрес из входящего заказа или чека: у разных источников разные поля */
export function addressOf(io: Raw, tx: Raw | null): ExternalOrder['address'] {
  const objs = [io.client_address, tx?.delivery, tx?.client_address].filter(
    (o): o is Raw => !!o && typeof o === 'object',
  );
  const line =
    objs.map((o) => str(o.address1)).find(Boolean) ||
    str(io.address) ||
    str(tx?.address) ||
    '';
  if (!line) return null;
  const extra = objs.map((o) => str(o.address2)).find(Boolean) ?? '';
  const comment = objs.map((o) => str(o.comment)).find(Boolean) ?? '';
  const point = objs.find((o) => num(o.lat) && num(o.lng));
  return {
    ...splitAddress(line),
    ...(extra ? { flat: extra } : {}),
    ...(comment ? { comment } : {}),
    ...(point ? { lat: num(point.lat), lng: num(point.lng) } : {}),
  };
}

/** Время Poster «2026-11-24 21:08:13» — по часам заведения (= сервера) */
export function posterTime(v: unknown): Date | null {
  const m = str(v).match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

export function isForeignAggregator(io: Raw): boolean {
  return /^\s*Яндекс\s*Еда/i.test(str(io.comment));
}

@Injectable()
export class PosterImportService {
  private readonly logger = new Logger(PosterImportService.name);
  /** Набор полей ответа Poster пишем в лог один раз — для разбора, без значений */
  private loggedShape = false;
  /** Последняя сводка по аккаунту — пишем в лог, только когда она меняется */
  private lastSummary = new Map<string, string>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
  ) {}

  @Cron('*/20 * * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const devices = await this.prisma.dispatchDevice.findMany({
        where: { isActive: true },
        select: { tenantId: true, venueId: true },
        distinct: ['tenantId'],
      });
      for (const d of devices) await this.importTenant(d.tenantId, d.venueId);
    } catch (e) {
      this.logger.error(`Заказы из Poster: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  async importTenant(tenantId: string, venueId: string, now = new Date()) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const cfg = courierSettings(tenant?.settings);
    if (cfg.posterImportWindowMin <= 0) return { created: 0, merged: 0 };
    const since = new Date(now.getTime() - cfg.posterImportWindowMin * 60_000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const accounts = await this.prisma.posterAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, token: true },
    });
    if (accounts.length === 0) return { created: 0, merged: 0 };

    // Наши заказы: их входящие номера в Poster записаны при отправке
    const dispatches = await this.prisma.orderDispatch.findMany({
      where: { order: { tenantId }, createdAt: { gte: new Date(dayStart.getTime() - 3_600_000) } },
      select: { posterAccountId: true, posterOrderId: true, replacedOrders: true },
    });
    const ours = new Set<string>();
    for (const d of dispatches) {
      if (d.posterOrderId) ours.add(`${d.posterAccountId}:${d.posterOrderId}`);
      for (const r of (d.replacedOrders as { posterOrderId?: string }[] | null) ?? []) {
        if (r?.posterOrderId) ours.add(`${d.posterAccountId}:${r.posterOrderId}`);
      }
    }

    const imported = await this.prisma.deliveryTask.findMany({
      where: { tenantId, source: 'POSTER', createdAt: { gte: new Date(dayStart.getTime() - 3_600_000) } },
      select: { id: true, status: true, external: true },
    });
    const known = new Map<string, { id: string; status: string }>();
    for (const t of imported) {
      for (const r of externalOf(t.external)?.refs ?? []) {
        known.set(`${r.accountId}:${r.incomingOrderId}`, { id: t.id, status: t.status });
      }
    }

    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let created = 0;
    let merged = 0;
    for (const acc of accounts) {
      let list: Raw[];
      try {
        list = (await this.poster.getIncomingOrders(acc.token, date)) ?? [];
      } catch (e) {
        this.logger.warn(`Poster: входящие заказы не получены: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!Array.isArray(list)) {
        this.logger.warn(`Poster: онлайн-заказы пришли не списком (${typeof list})`);
        continue;
      }
      if (!this.loggedShape && list[0]) {
        this.loggedShape = true;
        this.logger.log(`Poster входящий заказ, поля: ${Object.keys(list[0]).sort().join(', ')}`);
      }
      // Сводка без личных данных: сколько пришло и почему не взяли
      const why = { принято: 0, наши: 0, яндекс: 0, вЗале: 0, старые: 0, безАдреса: 0, уже: 0 };
      for (const io of list) {
        const id = str(io.incoming_order_id);
        if (!id) continue;
        const key = `${acc.id}:${id}`;
        const status = num(io.status);
        const seen = known.get(key);
        if (status === 1) {
          why.принято++;
          if (seen) why.уже++;
          else if (ours.has(key)) why.наши++;
          else if (isForeignAggregator(io)) why.яндекс++;
          else if (![2, 3].includes(num(io.service_mode))) why.вЗале++;
          else if ((posterTime(io.created_at) ?? now) < since) why.старые++;
        }

        // Кассир отклонил — плитку, которую ещё не взяли в работу, снимаем
        if (status === 7 && seen && ['NEW', 'READY'].includes(seen.status)) {
          await this.cancel(tenantId, seen.id);
          seen.status = 'CANCELLED';
          continue;
        }
        if (status !== 1 || seen || ours.has(key) || isForeignAggregator(io)) continue;
        const mode = num(io.service_mode);
        if (mode !== 2 && mode !== 3) continue;
        const createdAt = posterTime(io.created_at) ?? now;
        if (createdAt < since) continue;

        const res = await this.importOne(tenantId, venueId, acc.id, acc.token, io, createdAt, mode === 2, now);
        if (res === 'created') created++;
        if (res === 'merged') merged++;
        if (res === 'skipped') why.безАдреса++;
        known.set(key, { id: '', status: 'NEW' });
      }
      const summary = `всего ${list.length}, ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}`;
      if (this.lastSummary.get(acc.id) !== summary) {
        this.lastSummary.set(acc.id, summary);
        this.logger.log(`Poster онлайн-заказы за день (${acc.name}): ${summary}`);
      }
    }
    if (created || merged) this.logger.log(`Из Poster: новых плиток ${created}, склеено ${merged}`);
    return { created, merged };
  }

  private async importOne(
    tenantId: string,
    venueId: string,
    accountId: string,
    token: string,
    io: Raw,
    createdAt: Date,
    pickup: boolean,
    now: Date,
  ): Promise<'created' | 'merged' | 'skipped'> {
    const incomingOrderId = str(io.incoming_order_id);
    const transactionId = str(io.transaction_id) || null;
    let tx: Raw | null = null;
    if (transactionId && transactionId !== '0') {
      try {
        const r = await this.poster.getTransaction(token, transactionId);
        tx = (Array.isArray(r) ? r[0] : r) ?? null;
      } catch {
        tx = null;
      }
    }

    const address = pickup ? null : addressOf(io, tx);
    if (!pickup && !address) {
      // Доставка без адреса — это не заказ клиента старого приложения
      // (так приходят, например, агрегаторы). Не гадаем.
      return 'skipped';
    }

    const products = Array.isArray(io.products) ? (io.products as Raw[]) : [];
    const ids = products.map((p) => str(p.product_id)).filter(Boolean);
    const names = new Map(
      (
        await this.prisma.product.findMany({
          where: { posterAccountId: accountId, posterId: { in: ids } },
          select: { posterId: true, name: true },
        })
      ).map((p) => [p.posterId!, p.name]),
    );
    const items = products.map((p, i) => ({
      id: `${accountId}:${incomingOrderId}:${i}`,
      name: names.get(str(p.product_id)) ?? `Позиция ${str(p.product_id)}`,
      qty: Math.max(1, Math.round(num(p.count))),
      posterAccountId: accountId,
    }));
    const cash = money(tx?.payed_cash);
    const card = money(tx?.payed_card);
    const total = money(tx?.payed_sum) || money(tx?.sum);
    const phone = str(io.phone) || null;
    const name = [str(io.first_name), str(io.last_name)].filter(Boolean).join(' ') || null;
    const ref = { accountId, incomingOrderId, transactionId };

    // Вторая часть общего заказа (другой отдел) — в ту же плитку
    const key = phoneKey(phone);
    if (key) {
      const candidates = await this.prisma.deliveryTask.findMany({
        where: {
          tenantId,
          source: 'POSTER',
          status: { in: ['NEW', 'READY', 'ASSIGNED'] },
          kind: pickup ? 'PICKUP' : 'DELIVERY',
          createdAt: { gte: new Date(now.getTime() - 3 * MERGE_WINDOW_MS) },
        },
        select: { id: true, external: true, cashToCollect: true },
      });
      const twin = candidates.find((c) => {
        const e = externalOf(c.external);
        return (
          !!e &&
          phoneKey(e.phone) === key &&
          !e.refs.some((r) => r.accountId === accountId) &&
          Math.abs(new Date(e.createdAt).getTime() - createdAt.getTime()) <= MERGE_WINDOW_MS
        );
      });
      if (twin) {
        const e = externalOf(twin.external)!;
        const next: ExternalOrder = {
          ...e,
          address: e.address ?? address,
          comment: [e.comment, str(io.comment)].filter(Boolean).join(' · '),
          items: [...e.items, ...items],
          cash: e.cash + cash,
          card: e.card + card,
          total: e.total + total,
          refs: [...e.refs, ref],
        };
        await this.prisma.deliveryTask.update({
          where: { id: twin.id },
          data: {
            external: next as unknown as Prisma.InputJsonValue,
            cashToCollect: next.pickup ? 0 : next.cash,
            needsTerminal: !next.pickup && next.card > 0,
          },
        });
        await this.prisma.deliveryTaskEvent.create({
          data: { tenantId, taskId: twin.id, type: 'POSTER_MERGED', actor: 'SYSTEM', meta: { accountId, incomingOrderId } },
        });
        return 'merged';
      }
    }

    const external: ExternalOrder = {
      label: (transactionId ?? incomingOrderId).slice(-4),
      createdAt: createdAt.toISOString(),
      phone,
      name,
      address,
      comment: str(io.comment),
      items,
      cash,
      card,
      total,
      pickup,
      refs: [ref],
    };
    try {
      const task = await this.prisma.deliveryTask.create({
        data: {
          tenantId,
          venueId,
          kind: pickup ? 'PICKUP' : 'DELIVERY',
          source: 'POSTER',
          external: external as unknown as Prisma.InputJsonValue,
          externalKey: `${accountId}:${incomingOrderId}`,
          cashToCollect: pickup ? 0 : cash,
          // «Карточкой» в чеке старого приложения — оплата у двери
          needsTerminal: !pickup && card > 0,
          createdBy: 'POSTER',
        },
      });
      await this.prisma.deliveryTaskEvent.create({
        data: { tenantId, taskId: task.id, type: 'POSTER_IMPORTED', actor: 'SYSTEM', meta: { accountId, incomingOrderId } },
      });
      return 'created';
    } catch (e) {
      // Параллельный проход успел раньше
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'skipped';
      throw e;
    }
  }

  private async cancel(tenantId: string, taskId: string) {
    const changed = await this.prisma.deliveryTask.updateMany({
      where: { id: taskId, status: { in: ['NEW', 'READY'] } },
      data: { status: 'CANCELLED' },
    });
    if (changed.count > 0) {
      await this.prisma.deliveryTaskEvent.create({
        data: { tenantId, taskId, type: 'CANCELLED', actor: 'POSTER' },
      });
    }
  }
}
