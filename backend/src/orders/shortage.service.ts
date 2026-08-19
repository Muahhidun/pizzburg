import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from '../poster/poster.client';
import { PromotionsService } from '../promotions/promotions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CancelReasonsService } from './cancel-reasons.service';
import { TelegramService } from '../telegram/telegram.service';
import { ServiceReceiptService } from './service-receipt.service';
import { OrdersService } from './orders.service';
import { lineTotal, recalcAfterShortage, shrinkToOriginal } from './shortage-math';

/**
 * Сколько ждём ответа клиента (DECISIONS §12.9).
 *
 * Пять минут, а не десять: срок выбран по кухне, а не по удобству
 * клиента. За пять минут основной отдел обычно ещё не доготовил свою
 * часть — значит, если клиент выберет полную отмену, еда не пропадёт.
 * Десять минут этот запас съедали.
 */
export const SHORTAGE_WINDOW_MINUTES = 5;

type Decision = 'KEEP' | 'CANCEL';

/**
 * Нехватка позиции: первый этап (DECISIONS §12.9).
 *
 * Кассир не принимает заказ в Poster, а отмечает в консоли конкретную
 * позицию как отсутствующую. Клиент выбирает: везти без неё или отменить
 * заказ целиком; через пять минут без ответа везём остальное. Основной
 * отдел при этом готовит свою часть, не дожидаясь ответа.
 *
 * Замены («предложить другой ролл») — второй этап, здесь их нет
 * сознательно: сперва нужно увидеть, как часто это вообще случается.
 */
@Injectable()
export class ShortageService {
  private readonly logger = new Logger(ShortageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
    private readonly orders: OrdersService,
    private readonly promotions: PromotionsService,
    private readonly notifications: NotificationsService,
    private readonly cancelReasons: CancelReasonsService,
    private readonly telegram: TelegramService,
    private readonly serviceReceipt: ServiceReceiptService,
  ) {}

  // ─── Кассир ───────────────────────────────────────────────────────

  /**
   * Лента для консоли кассира: заказы, по которым ещё есть что решать.
   *
   * Не «заказы за сегодня»: в консоль она заходит только когда чего-то
   * нет, и ей нужен короткий список живых заказов, а не дневной отчёт.
   * Окно в 12 часов перекрывает смену и не тянет историю.
   */
  async queue(tenantId: string, now = new Date()) {
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        OR: [
          {
            status: { in: ['NEW', 'ACCEPTED'] },
            createdAt: { gt: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
          },
          // Отменённый заказ раньше просто исчезал из консоли, и кассир не
          // узнавала о нём ниоткуда: на планшет при отмене ничего не
          // уходит (Poster не умеет отменять чеки), пуш идёт клиенту.
          // Чек лежал как живой, и еду готовили. Показываем, пока чек не
          // отклонён на планшете, — как отклонит, строка уйдёт сама.
          {
            status: 'CANCELLED',
            cancelledAt: { gt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
            dispatches: {
              some: {
                status: 'SENT',
                posterOrderId: { not: null },
                // См. комментарий в OrdersService.tellCashierOrderDied:
                // `not` в Prisma отсекает NULL, а именно NULL стоит у
                // чека, который ещё висит на планшете нетронутым.
                OR: [{ posterStatus: null }, { posterStatus: { not: 'REJECTED' } }],
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true, phone: true } },
        items: {
          include: { product: { select: { posterAccountId: true } } },
        },
        dispatches: {
          include: { posterAccount: { select: { id: true, name: true, sortOrder: true } } },
          orderBy: { posterAccount: { sortOrder: 'asc' } },
        },
      },
    });

    // «Похоже на перезаказ» — только пометка кассиру. Ни один заказ
    // автоматически не отменяется: решает человек, глядя на оба.
    const activeByCustomer = await this.orders.otherActiveOrders(
      tenantId,
      orders.map((o) => o.customerId ?? ''),
    );

    const departmentById = new Map<string, string>();
    for (const order of orders) {
      for (const d of order.dispatches) {
        departmentById.set(d.posterAccount.id, d.posterAccount.name);
      }
    }

    return {
      windowMinutes: SHORTAGE_WINDOW_MINUTES,
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        createdAt: o.createdAt,
        scheduledAt: o.scheduledAt,
        type: o.type,
        status: o.status,
        paymentMethod: o.paymentMethod,
        customer: o.customer,
        comment: o.comment,
        total: o.total,
        shortageState: o.shortageState,
        shortageDeadline: o.shortageDeadline,
        shortageResolvedBy: o.shortageResolvedBy,
        cancelReason: o.cancelReason,
        cancelledBy: o.cancelledBy,
        /// Чеки, которые ещё висят на планшетах у отменённого заказа
        receiptsToReject:
          o.status === 'CANCELLED'
            ? o.dispatches
                .filter(
                  (d) =>
                    d.status === 'SENT' &&
                    d.posterStatus !== 'REJECTED' &&
                    d.posterOrderId &&
                    d.posterOrderId !== 'dry-run',
                )
                .map((d) => ({
                  department: d.posterAccount.name,
                  posterOrderId: d.posterOrderId as string,
                }))
            : [],
        otherActiveOrders: (activeByCustomer.get(o.customerId ?? '') ?? [])
          .filter((n) => n !== o.number),
        items: o.items.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          price: i.price,
          isGift: i.isGift,
          isUnavailable: i.isUnavailable,
          department: i.product
            ? (departmentById.get(i.product.posterAccountId) ?? '—')
            : '—',
        })),
        parts: o.dispatches.map((d) => ({
          department: d.posterAccount.name,
          status: d.status,
          posterStatus: d.posterStatus,
          posterOrderId: d.posterOrderId,
          error: d.error,
          replacedOrders: d.replacedOrders,
        })),
      })),
    };
  }

  /**
   * Кассир отмечает позиции, которых нет.
   *
   * Пустой список — «позиции нашлись»: снимает пометку и возвращает заказ
   * в обычный ход. Отдельной кнопки отмены не нужно, а промах по чекбоксу
   * при живом ожидании клиента отменить надо обязательно.
   */
  async markUnavailable(
    tenantId: string,
    orderId: string,
    itemIds: string[],
    now = new Date(),
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { include: { product: { select: { posterAccountId: true } } } },
        dispatches: { include: { posterAccount: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
      throw new BadRequestException('Заказ уже закрыт');
    }

    const wanted = [...new Set(itemIds)];
    if (wanted.length === 0) return this.clearShortage(order.id);

    const marked = order.items.filter((i) => wanted.includes(i.id));
    if (marked.length !== wanted.length) {
      throw new BadRequestException('Позиция не из этого заказа');
    }
    // Подарок отмечать нечего: он не выбор клиента, а следствие состава, и
    // пересчитается сам, когда исчезнет позиция-условие.
    if (marked.some((i) => i.isGift)) {
      throw new BadRequestException(
        'Подарок по акции отмечать не нужно — он пересчитается сам',
      );
    }
    const remaining = order.items.filter(
      (i) => !i.isGift && !wanted.includes(i.id),
    );
    if (remaining.length === 0) {
      throw new BadRequestException(
        'Не осталось ни одной позиции — отмените заказ целиком с причиной',
      );
    }

    // Разбирательство идёт, пока заказ не принят: исправленный состав
    // уходит в Poster новым чеком, а поверх принятого его класть нельзя —
    // получится две готовки. Проверяем не сохранённый статус, а живой: он
    // обновляется раз в минуту, и за эту минуту заказ могли принять.
    const affected = new Set(
      marked.map((i) => i.product?.posterAccountId).filter(Boolean),
    );
    for (const d of order.dispatches) {
      if (!affected.has(d.posterAccountId)) continue;
      if (await this.isAcceptedInPoster(d)) {
        throw new BadRequestException(
          `«${d.posterAccount.name}» уже принял заказ на планшете. ` +
            'Исправленный состав туда не уйдёт — договоритесь с клиентом по телефону',
        );
      }
    }

    // Повторная пометка не сдвигает срок: иначе каждый клик кассира давал
    // бы клиенту новые пять минут, а кухня всё это время ждала.
    const alreadyWaiting = order.shortageState === 'AWAITING_CUSTOMER';
    await this.prisma.$transaction([
      this.prisma.orderItem.updateMany({
        where: { orderId: order.id, id: { notIn: wanted } },
        data: { isUnavailable: false },
      }),
      this.prisma.orderItem.updateMany({
        where: { orderId: order.id, id: { in: wanted } },
        data: { isUnavailable: true },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          shortageState: 'AWAITING_CUSTOMER',
          shortageAt: alreadyWaiting ? (order.shortageAt ?? now) : now,
          shortageDeadline: alreadyWaiting
            ? (order.shortageDeadline ??
              new Date(now.getTime() + SHORTAGE_WINDOW_MINUTES * 60_000))
            : new Date(now.getTime() + SHORTAGE_WINDOW_MINUTES * 60_000),
          shortageResolvedBy: null,
          shortageResolvedAt: null,
        },
      }),
    ]);

    const names = marked.map((i) => i.name).join(', ');
    this.logger.log(
      `Заказ №${order.number}: нет позиций (${names}) — ждём ответа клиента до ` +
        `${SHORTAGE_WINDOW_MINUTES} мин`,
    );
    await this.notifications.sendOrderEvent(
      order.id,
      {
        title: `Заказ №${order.number}`,
        body: `Не оказалось: ${names}. Везём остальное или отменяем?`,
      },
      { type: 'order_shortage' },
    );
    // Руководству — не ход разбирательства, а факт, о котором есть смысл
    // спросить человека: почему позиции не оказалось — повар, закуп,
    // забыли поставить стоп? Пошаговый пересказ процесса замыливает глаз,
    // и тогда в потоке теряется то, что действительно влияет на бизнес.
    await this.telegram.notify(
      order.tenantId,
      `❗️ <b>Кассир отметил позицию отсутствующей</b>\n` +
        `Заказ №${order.number}: «${names}».`,
    );

    return this.state(order.id);
  }

  /**
   * Второй отдел отклонил чек на планшете — спрашиваем клиента.
   *
   * Кассира учат идти в консоль, а не жать «Отклонить», но правило,
   * которое держится только на дисциплине, рано или поздно нарушится. А
   * цена нарушения здесь несоразмерна: заказ поехал бы неполным, а клиент
   * заплатил бы полную сумму и узнал обо всём у двери.
   *
   * Поэтому отказ второго отдела приводит к тому же результату, что и
   * ручная пометка: его позиции считаются отсутствующими, клиент получает
   * свой выбор. Отказ ОСНОВНОГО отдела сюда не попадает — он по-прежнему
   * отменяет заказ целиком (DECISIONS §12.4), и спрашивать там нечего.
   */
  async handleRejectedDepartments(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { posterAccountId: true } } } },
        dispatches: {
          include: { posterAccount: { select: { name: true } } },
          orderBy: { posterAccount: { sortOrder: 'asc' } },
        },
      },
    });
    if (!order) return;
    if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return;
    // Разбирательство уже идёт или уже закончилось — второй заход только
    // сбил бы клиенту срок ответа. Повторный отказ после решения кассир
    // видит в консоли красной плашкой и разбирает звонком.
    if (order.shortageState !== 'NONE') return;

    const live = order.dispatches.filter((d) => d.status !== 'VOID');
    const main = live[0];
    const rejected = live.filter(
      (d) => d.posterStatus === 'REJECTED' && d.id !== main?.id,
    );
    if (rejected.length === 0) return;

    const accounts = new Set(rejected.map((d) => d.posterAccountId));
    const itemIds = order.items
      .filter(
        (i) =>
          !i.isGift &&
          i.product &&
          accounts.has(i.product.posterAccountId) &&
          !i.isUnavailable,
      )
      .map((i) => i.id);
    if (itemIds.length === 0) return;

    const names = rejected.map((d) => d.posterAccount.name).join(', ');
    this.logger.warn(
      `Заказ №${order.number}: ${names} отклонил чек на планшете — ` +
        'спрашиваем клиента по позициям',
    );
    // Соседний отдел об этом иначе не узнает: он видит свой чек живым и
    // спокойно готовит, не зная, что половина заказа отвалилась и клиента
    // сейчас спрашивают, везти ли остальное. Сообщение уходит в общий чат
    // кассы — там сидят оба отдела.
    const others = live
      .filter((d) => !accounts.has(d.posterAccountId))
      .map((d) => d.posterAccount.name);
    if (others.length > 0) {
      await this.telegram.notifyCashier(
        order.tenantId,
        `⚠️ <b>Заказ №${order.number}: ${names} отклонил свою часть</b>\n` +
          `${others.join(', ')} — ваша часть в силе, но состав меняется.\n` +
          `Спрашиваем клиента, везти ли остальное (${SHORTAGE_WINDOW_MINUTES} мин).`,
      );
    }
    try {
      await this.markUnavailable(order.tenantId, order.id, itemIds);
    } catch (e) {
      // Не роняем круг опроса: остальные заказы должны обновиться
      this.logger.error(`Отказ отдела по заказу №${order.number} не обработан: ${e}`);
    }
  }

  /**
   * «Позиции нашлись» — снимаем пометку, заказ идёт обычным ходом.
   *
   * Работает, только пока ждём ответа клиента. После ответа сумма уже
   * пересчитана, лишние баллы возвращены, а исправленный чек ушёл в
   * кассу: вернуть строку в состав здесь значило бы показать полный
   * заказ по уменьшенной цене и ничего не сообщить кухне. Позицию,
   * которая нашлась слишком поздно, добавляют звонком и новым заказом.
   */
  private async clearShortage(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { shortageState: true },
    });
    if (order.shortageState === 'NONE') return this.state(orderId);
    if (order.shortageState !== 'AWAITING_CUSTOMER') {
      throw new BadRequestException(
        'Клиент уже получил ответ, и сумма пересчитана — ' +
          'позицию можно вернуть только новым заказом',
      );
    }
    await this.prisma.$transaction([
      this.prisma.orderItem.updateMany({
        where: { orderId },
        data: { isUnavailable: false },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          shortageState: 'NONE',
          shortageAt: null,
          shortageDeadline: null,
          shortageResolvedBy: null,
          shortageResolvedAt: null,
        },
      }),
    ]);
    return this.state(orderId);
  }

  // ─── Клиент ───────────────────────────────────────────────────────

  /** Ответ клиента: везти без позиции или отменить заказ целиком */
  async respond(orderId: string, customerId: string, decision: Decision) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true, number: true, shortageState: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    // Ответ мог разойтись с таймаутом на секунды: если решение уже
    // совпадает с выбранным, это не ошибка, а второй клик.
    if (
      (decision === 'KEEP' && order.shortageState === 'KEPT_REST') ||
      (decision === 'CANCEL' &&
        order.shortageState === 'CANCELLED_BY_CUSTOMER')
    ) {
      return this.state(order.id);
    }
    if (order.shortageState !== 'AWAITING_CUSTOMER') {
      throw new BadRequestException(
        'По этому заказу ответ уже не нужен — позвоните нам, если что-то не так',
      );
    }

    return decision === 'KEEP'
      ? this.keepRest(order.id, 'CUSTOMER')
      : this.cancelWholeOrder(order.id);
  }

  // ─── Таймаут ──────────────────────────────────────────────────────

  /**
   * Через пять минут молчания решаем сами — везём остальное.
   *
   * Отмена «за клиента» здесь невозможна намеренно: не ответивший человек
   * скорее не в сети, чем передумал, а еда основного отдела уже готова.
   * Заказ остаётся подсвеченным кассиру как требующий звонка.
   */
  @Cron('*/1 * * * *')
  async resolveExpired(now = new Date()) {
    const expired = await this.prisma.order.findMany({
      where: {
        shortageState: 'AWAITING_CUSTOMER',
        shortageDeadline: { lte: now },
        // Только живые заказы. Отменённый заказ ничего не ждёт, и решать
        // за клиента по нему нечего: раньше такой заказ находился по
        // одному лишь `shortageState`, пересчитывался и получал новый чек
        // на планшет — кассир видела бумагу по отменённому заказу.
        status: { notIn: ['CANCELLED', 'DELIVERED'] },
      },
      select: { id: true, number: true },
    });
    for (const order of expired) {
      try {
        await this.keepRest(order.id, 'TIMEOUT');
        this.logger.log(
          `Заказ №${order.number}: клиент не ответил за ${SHORTAGE_WINDOW_MINUTES} мин — везём остальное`,
        );
      } catch (e) {
        this.logger.warn(`Таймаут по заказу №${order.number} не отработал: ${e}`);
      }
    }
  }

  // ─── Решения ──────────────────────────────────────────────────────

  /**
   * Везём остальное: пересчитываем заказ и отправляем в кассу
   * исправленный состав.
   */
  private async keepRest(orderId: string, by: 'CUSTOMER' | 'TIMEOUT') {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { posterAccountId: true } } } },
        dispatches: { include: { posterAccount: { select: { name: true } } } },
      },
    });

    // Второй рубеж к фильтру в `resolveExpired`: сюда же ведёт ответ
    // клиента, а он мог нажать кнопку ровно в момент отмены заказа
    // оператором. Пересчитывать и слать чек по закрытому заказу нельзя.
    if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
      await this.prisma.order.updateMany({
        where: { id: order.id, shortageState: 'AWAITING_CUSTOMER' },
        data: { shortageState: 'NONE', shortageDeadline: null },
      });
      this.logger.warn(
        `Заказ №${order.number} уже закрыт (${order.status}) — ожидание снято без пересчёта`,
      );
      return this.state(order.id);
    }

    const gone = order.items.filter((i) => i.isUnavailable);
    const payable = order.items.filter((i) => !i.isGift && !i.isUnavailable);

    // Отделы, чей состав изменился, — им уйдёт новый чек. Считаем не
    // только по снятым позициям: пропавший подарок мог лежать в другом
    // отделе, и его чек тоже перестал быть верным.
    const changed = new Set(
      gone.map((i) => i.product?.posterAccountId).filter(Boolean),
    );

    const promo = await this.reevaluatePromotions(order, payable);
    const keptGifts = shrinkToOriginal(
      promo.gifts,
      order.items.filter((i) => i.isGift),
    );
    const giftValue = keptGifts.reduce((sum, g) => sum + g.price * g.qty, 0);

    const totals = recalcAfterShortage({
      remaining: payable.map((i) => ({
        price: i.price,
        qty: i.qty,
        modifiers: i.modifiers as { price?: number | null }[] | null,
      })),
      giftValue,
      moneyDiscount: Math.min(promo.moneyDiscount, order.promoDiscount),
      deliveryFee: order.deliveryFee,
      pointsSpent: order.pointsSpent,
      originalTotal: order.total,
    });

    // Подарки пересобираем строками целиком: сравнивать построчно дороже,
    // чем переписать, а внешних ссылок на строку подарка нет.
    const giftsBefore = order.items.filter((i) => i.isGift);
    const giftProducts = keptGifts.length
      ? await this.prisma.product.findMany({
          where: { id: { in: keptGifts.map((g) => g.productId) } },
          select: { id: true, posterAccountId: true },
        })
      : [];
    const giftAccountById = new Map(
      giftProducts.map((p) => [p.id, p.posterAccountId]),
    );
    const giftKey = (list: { productId: string | null; qty: number }[]) =>
      list
        .map((g) => `${g.productId}×${g.qty}`)
        .sort()
        .join('|');
    // Набор подарков изменился — значит изменился и состав тех отделов, где
    // они лежат. Подарок SunDay при пропаже позиции PizzBurg меняет чек
    // обоих отделов, хотя нехватка была в одном.
    if (giftKey(giftsBefore) !== giftKey(keptGifts)) {
      for (const before of giftsBefore) {
        if (before.product) changed.add(before.product.posterAccountId);
      }
      for (const gift of keptGifts) {
        const account = giftAccountById.get(gift.productId);
        if (account) changed.add(account);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: order.id, isGift: true } });
      if (keptGifts.length > 0) {
        await tx.orderItem.createMany({
          data: keptGifts.map((g) => ({
            orderId: order.id,
            productId: g.productId,
            name: g.name,
            price: g.price,
            qty: g.qty,
            isGift: true,
          })),
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          deliveryFee: totals.deliveryFee,
          discount: totals.discount,
          promoDiscount: totals.moneyDiscount,
          pointsSpent: totals.pointsSpent,
          total: totals.total,
          shortageState: 'KEPT_REST',
          shortageResolvedBy: by,
          shortageResolvedAt: new Date(),
        },
      });

      // Баллы возвращаем сразу: клиент оплатил ими то, чего не привезут.
      if (totals.pointsRefund > 0 && order.customerId) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: { pointsBalance: { increment: totals.pointsRefund } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            tenantId: order.tenantId,
            customerId: order.customerId,
            orderId: order.id,
            type: 'ADJUST',
            amount: totals.pointsRefund,
            comment: `Возврат баллов: позиции не было в заказе №${order.number}`,
          },
        });
      }
    });

    // Части, в которых не осталось ни одной позиции, гасим: готовить там
    // нечего. Отменить чек через API Poster нельзя, поэтому оставляем
    // кассиру явное указание, что отклонить на планшете.
    const resend: string[] = [];
    for (const d of order.dispatches) {
      if (!changed.has(d.posterAccountId)) continue;
      const left =
        payable.some((i) => i.product?.posterAccountId === d.posterAccountId) ||
        keptGifts.some(
          (g) => giftAccountById.get(g.productId) === d.posterAccountId,
        );
      if (!left) {
        // Отдел, который сам отклонил чек, просить отклонить его ещё раз
        // не нужно — это шум в единственном месте, куда кассир смотрит.
        const alreadyRejected = d.posterStatus === 'REJECTED';
        if (!alreadyRejected && d.posterOrderId && d.posterOrderId !== 'dry-run') {
          await this.telegram.notifyCashier(
            order.tenantId,
            `🚫 <b>Заказ №${order.number}</b>: в части «${d.posterAccount.name}» ` +
              `не осталось позиций.\nОтклоните чек №${d.posterOrderId} на планшете.`,
          );
          // Замыкаем контур на планшете: за время разбирательства отдел
          // получает ровно одно из двух — исправленный чек или этот.
          await this.serviceReceipt.send(
            d.posterAccountId,
            `ЗАКАЗ №${order.number}: ПОЗИЦИЙ ЭТОЙ ЧАСТИ НЕ ОСТАЛОСЬ. ` +
              `ОТКЛОНИТЕ ЧЕК №${d.posterOrderId}, НЕ ГОТОВЬТЕ.`,
          );
        }
        await this.prisma.orderDispatch.update({
          where: { id: d.id },
          data: {
            status: 'VOID',
            error: alreadyRejected
              ? 'Часть отменена отделом, клиент согласился на остальное'
              : d.posterOrderId
                ? `Позиций этой части не осталось — отклоните чек №${d.posterOrderId} на планшете`
                : 'Позиций этой части не осталось',
          },
        });
        continue;
      }
      resend.push(d.id);
    }
    if (resend.length > 0) {
      await this.orders.dispatchToPoster(order.id, { resend });
    }

    const names = gone.map((i) => i.name).join(', ');
    // Руководству итог разбирательства не отправляем: «везём без ролла»
    // ничего не меняет в работе отдела, а поток таких сообщений и есть
    // тот шум, из-за которого перестают замечать важное.
    //
    // Кассе — только когда нужно действие. Клиент подтвердил сам:
    // исправленный чек уже печатается, добавить нечего. А вот молчание
    // означает звонок, и об этом принтер не скажет.
    if (by === 'TIMEOUT') {
      await this.telegram.notifyCashier(
        order.tenantId,
        `📞 <b>Заказ №${order.number}</b>: клиент не ответил за ` +
          `${SHORTAGE_WINDOW_MINUTES} мин.\nВезём без «${names}», ` +
          `к оплате ${totals.total} ₸.\nПозвоните клиенту и предупредите.`,
      );
    }
    await this.notifications.sendOrderEvent(
      order.id,
      {
        title: `Заказ №${order.number}`,
        body: `Везём без «${names}». К оплате ${totals.total} ₸`,
      },
      { type: 'order_shortage_resolved', decision: 'KEEP', resolvedBy: by },
    );

    return this.state(order.id);
  }

  /** Клиент отказался от заказа целиком из-за нехватки позиции */
  private async cancelWholeOrder(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, tenantId: true },
    });
    const reasonId = await this.cancelReasons.shortageReasonId(order.tenantId);

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        cancelReasonId: reasonId,
        cancelReason: CancelReasonsService.shortageLabel,
        // Решение принял клиент, но причина — наша нехватка: в отчёте
        // важны обе половины, иначе строка выглядит как «передумал».
        cancelledBy: 'CUSTOMER',
        cancelledAt: new Date(),
        shortageState: 'CANCELLED_BY_CUSTOMER',
        shortageResolvedBy: 'CUSTOMER',
        shortageResolvedAt: new Date(),
      },
    });
    // setStatus вернёт списанные баллы и уведомит клиента об отмене
    await this.orders.setStatus(order.id, 'CANCELLED', order.tenantId);
    return this.state(order.id);
  }

  // ─── Вспомогательное ──────────────────────────────────────────────

  /**
   * Переоценка акций по оставшемуся составу.
   *
   * Заказ уже записан в PromotionUse, поэтому собственные применения из
   * лимитов исключаем, а «первый заказ» считаем по заказам ДО этого —
   * иначе акция выглядела бы исчерпанной сама собой и подарок пропал бы
   * не из-за нехватки, а из-за пересчёта.
   */
  private async reevaluatePromotions(
    order: {
      id: string;
      tenantId: string;
      type: 'DELIVERY' | 'PICKUP';
      promoCode: string | null;
      customerId: string | null;
      createdAt: Date;
    },
    payable: {
      productId: string | null;
      qty: number;
      price: number;
      modifiers: unknown;
    }[],
  ) {
    const subtotal = payable.reduce(
      (sum, i) =>
        sum +
        lineTotal({
          price: i.price,
          qty: i.qty,
          modifiers: i.modifiers as { price?: number | null }[] | null,
        }),
      0,
    );
    const ordersBefore = order.customerId
      ? await this.prisma.order.count({
          where: { customerId: order.customerId, createdAt: { lt: order.createdAt } },
        })
      : 0;

    return this.promotions.evaluate(
      order.tenantId,
      payable
        .filter((i) => i.productId)
        .map((i) => ({ productId: i.productId as string, qty: i.qty })),
      order.promoCode ?? undefined,
      {
        subtotal,
        orderType: order.type,
        customerId: order.customerId ?? undefined,
        isFirstOrder: ordersBefore === 0,
        excludeOrderId: order.id,
      },
    );
  }

  /** Принят ли чек этой части на планшете прямо сейчас */
  private async isAcceptedInPoster(dispatch: {
    posterOrderId: string | null;
    posterStatus: string | null;
    posterAccount: { token: string };
  }) {
    if (!dispatch.posterOrderId || dispatch.posterOrderId === 'dry-run') {
      return false;
    }
    try {
      const live = await this.poster.getIncomingOrder(
        dispatch.posterAccount.token,
        dispatch.posterOrderId,
      );
      return live.status === 1;
    } catch (e) {
      // Poster недоступен — доверяем последнему известному статусу.
      // Считать «не принят» безопаснее для клиента, но опаснее для кухни,
      // поэтому опираемся на то, что успел увидеть опрос.
      this.logger.warn(`Живой статус чека ${dispatch.posterOrderId} не получен: ${e}`);
      return dispatch.posterStatus === 'ACCEPTED';
    }
  }

  /** Состояние разбирательства для клиента и для консоли */
  private async state(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        subtotal: true,
        discount: true,
        pointsSpent: true,
        shortageState: true,
        shortageAt: true,
        shortageDeadline: true,
        shortageResolvedBy: true,
        items: {
          select: {
            id: true,
            name: true,
            qty: true,
            price: true,
            isGift: true,
            isUnavailable: true,
          },
        },
      },
    });
    return order;
  }
}
