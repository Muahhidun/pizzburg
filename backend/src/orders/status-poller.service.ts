import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { ShortageService } from './shortage.service';

/** Через сколько принятый заказ закрывается сам (см. DECISIONS §12.8) */
const AUTO_CLOSE_HOURS = 3;

/**
 * Раз в минуту подтягивает статусы активных заказов с планшетов Poster.
 * Смена агрегированного статуса проходит через OrdersService.setStatus,
 * где сохраняется статус, обрабатывается лояльность и отправляется FCM.
 */
@Injectable()
export class StatusPollerService {
  private readonly logger = new Logger(StatusPollerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly shortage: ShortageService,
  ) {}

  @Cron('*/1 * * * *')
  async poll() {
    const active = await this.prisma.order.findMany({
      where: {
        OR: [
          {
            status: { in: ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
            createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          // Недавно отменённые опрашиваем тоже, и это не расточительство.
          // Отменить чек через API Poster нельзя, поэтому кассир отклоняет
          // его руками, а узнать, что она это сделала, можно только
          // спросив планшет. Без этого напоминание «отклоните чек» висело
          // бы в консоли и после того, как всё уже сделано, — и его бы
          // перестали читать.
          {
            status: 'CANCELLED',
            cancelledAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
            dispatches: {
              some: {
                OR: [{ posterStatus: null }, { posterStatus: { not: 'REJECTED' } }],
              },
            },
          },
        ],
        dispatches: {
          some: { status: 'SENT', posterOrderId: { not: 'dry-run' } },
        },
      },
      select: { id: true, number: true, status: true },
    });
    // Раньше цикл молчал, пока статус не менялся, и «опрос не видит заказ»
    // выглядело в логах ровно как «Poster ещё не принял». Отличить одно от
    // другого было нечем, поэтому пишем сам факт круга и что ответил Poster
    // по каждой части.
    if (active.length === 0) return;
    this.logger.log(
      `Опрос: активных заказов ${active.length} (${active
        .map((o) => `№${o.number}/${o.status}`)
        .join(', ')})`,
    );
    for (const o of active) {
      try {
        const res = await this.orders.syncStatus(o.id);
        if (res.status !== o.status) {
          this.logger.log(
            `Заказ №${o.number}: ${o.status} → ${res.status}`,
          );
        } else {
          this.logger.log(
            `Заказ №${o.number}: без изменений (${res.parts
              .map((p) => `${p.department}=${p.posterStatus ?? 'нет ответа'}`)
              .join(', ')})`,
          );
        }
        // Отказ второго отдела на планшете — не отмена заказа, а нехватка
        // всех его позиций: клиента нужно спросить, везти ли остальное.
        // Проверка идемпотентна и стоит один запрос, поэтому висит на
        // каждом круге, а не на «статус изменился»: отказ мог приехать и
        // синхронизацией из приложения, между кругами опроса.
        await this.shortage.handleRejectedDepartments(o.id);
      } catch (e) {
        this.logger.warn(`Poll failed for order ${o.id}: ${e}`);
      }
    }
  }

  /**
   * Отправляет в кассу заказы, у которых истекло окно отмены.
   *
   * Раз в 10 секунд, а не раз в минуту: задержка и так съедает у кухни
   * больше минуты, и добавлять к ней случайные полминуты нельзя — в час
   * пик это заметно.
   *
   * Отмена в окно отмены снимает срок вместе со статусом: отменённый
   * заказ сюда не попадает и на планшеты не уходит вовсе.
   */
  @Cron('*/10 * * * * *')
  async dispatchDue() {
    const due = await this.prisma.order.findMany({
      where: {
        dispatchAfter: { lte: new Date() },
        status: { notIn: ['CANCELLED', 'DELIVERED'] },
        // Будущий онлайн-заказ не попадёт на планшет до Processed, даже
        // если срок отправки был выставлен ошибочно или вручную.
        OR: [
          { paymentMethod: { not: 'KASPI_ONLINE' } },
          { paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
        ],
      },
      select: { id: true, number: true },
    });
    for (const o of due) {
      try {
        await this.orders.dispatchToPoster(o.id);
        // Снимаем срок только после отправки: если она упала, следующий
        // круг попробует снова, а не забудет заказ навсегда.
        await this.prisma.order.update({
          where: { id: o.id },
          data: { dispatchAfter: null },
        });
        this.logger.log(`Заказ №${o.number} отправлен в кассу: окно отмены истекло`);
      } catch (e) {
        this.logger.error(`Отправка заказа №${o.number} не удалась: ${e}`);
      }
    }
  }

  /**
   * Закрывает заказы, которые давно приняли и о которых больше никто не
   * отчитается.
   *
   * Poster сообщает только приём и отказ, курьерского модуля пока нет, и
   * «доставлен» не ставит никто. Из-за этого заказ оставался активным
   * навсегда: висел карточкой на главном экране и числился активным в
   * истории. Три часа с запасом перекрывают доставку даже в час пик.
   *
   * Отсчёт идёт от `updatedAt` — момента, когда статус стал ACCEPTED.
   * Отдельного `acceptedAt` в модели нет, а принятый заказ до закрытия
   * больше ничем не трогают, так что это то же самое время.
   *
   * Закрываем через `setStatus`, а не прямым апдейтом: там начисляется
   * кэшбэк. Владелец сознательно принял риск начислить его и за заказ,
   * отменённый по телефону, — недоначисление раздражает клиента сильнее.
   * Клиенту при этом ничего не отправляем: через три часа он давно поел,
   * и уведомление «заказ завершён» было бы шумом.
   */
  @Cron('*/5 * * * *')
  async closeStale() {
    const threshold = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: { in: ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'ON_WAY'] },
        updatedAt: { lt: threshold },
      },
      select: { id: true, number: true, tenantId: true, status: true },
    });
    for (const o of stale) {
      // Принятый заказ доехал — закрываем доставкой, с кэшбэком. А тот,
      // который кухня за три часа так и не приняла, никто не готовил и не
      // вёз: закрывать его доставкой значило бы начислить кэшбэк за еду,
      // которой не было. Такой заказ отменяем — заодно вернутся списанные
      // баллы.
      const delivered = o.status !== 'NEW';
      const next = (delivered ? 'DELIVERED' : 'CANCELLED') as OrderStatus;
      try {
        await this.orders.setStatus(o.id, next, o.tenantId, { notify: false });
        this.logger.log(
          `Заказ №${o.number} закрыт автоматически как ${next}: ` +
            `${AUTO_CLOSE_HOURS} ч без движения`,
        );
      } catch (e) {
        this.logger.warn(`Автозакрытие №${o.number} не удалось: ${e}`);
      }
    }
  }
}
