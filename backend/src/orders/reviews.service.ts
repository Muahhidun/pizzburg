import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { questionsFor, scoreReview } from './review-form';

/**
 * Через сколько после оформления спрашиваем впечатления.
 *
 * Конечного статуса у заказа пока нет — курьерского модуля тоже, — и
 * узнать момент вручения нам неоткуда. Берём с запасом: через два с
 * половиной часа почти любой заказ доставлен и съеден, и человек может
 * судить о еде, а не о том, что пакет тяжёлый.
 */
export const REVIEW_DELAY_MS = 150 * 60_000;

/** Спрашивать позже этого срока бессмысленно: вчерашнее уже не вспомнят */
export const REVIEW_WINDOW_MS = 24 * 60 * 60_000;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Анкета под конкретный заказ: у самовывоза курьера нет */
  async form(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { type: true, status: true, review: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return {
      alreadyAnswered: Boolean(order.review),
      questions: questionsFor(order.type),
    };
  }

  async submit(
    orderId: string,
    input: { answers: Record<string, string>; text?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        tenantId: true,
        customer: { select: { phone: true } },
        review: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.review) {
      throw new BadRequestException('Спасибо, отзыв по этому заказу уже есть');
    }
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Заказ отменён — оценивать нечего');
    }

    const { rating, hasWorst, lines } = scoreReview(input.answers, order.type);
    if (rating === 0) {
      throw new BadRequestException('Ответьте хотя бы на один вопрос');
    }

    const text = (input.text ?? '').trim().slice(0, 1000);
    const review = await this.prisma.orderReview.create({
      data: {
        orderId: order.id,
        tenantId: order.tenantId,
        answers: input.answers,
        rating,
        text,
        alerted: hasWorst,
      },
    });

    // В чаты — только когда что-то пошло совсем плохо.
    //
    // Хороший отзыв не требует человека, и если слать все подряд,
    // кассирский чат перестанут читать — вместе с обращениями по живым
    // заказам, ради которых он и заведён (§12.11). Забытая позиция при
    // четырёх пятёрках всё равно поднимает смену: соус надо привезти.
    if (hasWorst) {
      const message =
        `⚠️ Заказ №${order.number}: ${rating}/5\n\n` +
        lines.join('\n') +
        (text ? `\n\n«${text}»` : '') +
        `\n\n${order.customer?.phone ?? ''}`;
      await Promise.all([
        this.telegram.notifyCashier(order.tenantId, message),
        this.telegram.notify(order.tenantId, message),
      ]);
    }

    return { id: review.id, rating };
  }

  /**
   * Заказ, по которому ждём отзыв, — для блока на главной.
   *
   * Пуш можно смахнуть, и тогда анкета исчезнет навсегда. Поэтому
   * просьба живёт ещё и на главной, в том же месте, где обычно стоит
   * «Повторить заказ»: человек всё равно туда заходит.
   */
  async pending(customerId: string, now = new Date()) {
    const order = await this.prisma.order.findFirst({
      where: {
        customerId,
        status: { notIn: ['CANCELLED'] },
        review: null,
        createdAt: {
          lte: new Date(now.getTime() - REVIEW_DELAY_MS),
          gte: new Date(now.getTime() - REVIEW_WINDOW_MS),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true },
    });
    return order ?? null;
  }

  /**
   * Кого пора спросить.
   *
   * Раз в пять минут: точность здесь не нужна, а лишние пробуждения
   * базы — нужны ещё меньше.
   */
  @Cron('*/5 * * * *')
  async askDue(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: {
        reviewAskedAt: null,
        status: { notIn: ['CANCELLED'] },
        createdAt: {
          lte: new Date(now.getTime() - REVIEW_DELAY_MS),
          // Старые заказы не трогаем: если задача стояла сутки, не надо
          // будить людей вопросом о позавчерашнем ужине
          gte: new Date(now.getTime() - REVIEW_WINDOW_MS),
        },
        review: null,
      },
      select: { id: true, number: true },
      take: 50,
    });

    for (const order of due) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { reviewAskedAt: now },
      });
      await this.notifications.sendOrderEvent(
        order.id,
        {
          title: 'Как всё прошло?',
          body: `Оцените заказ №${order.number} — это пара нажатий`,
        },
        // Свой тип, а не `order_status`: приложение должно открыть
        // анкету, а не шкалу статусов
        { type: 'review' },
      );
    }

    if (due.length) this.logger.log(`Анкета: спросили по ${due.length} заказам`);
    return { asked: due.length };
  }
}
