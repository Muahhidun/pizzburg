import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosterClient } from '../poster/poster.client';

/**
 * Служебный чек — сообщение кассиру на её рабочее место.
 *
 * Предложено владельцем по итогам живых тестов, и довод оказался сильнее
 * телеграма для этого случая: у кассира должен быть **замкнутый контур**
 * на планшете. Она не держит открытой вкладку админки и не смотрит в
 * телефон посреди смены, а вот печатающийся чек не заметить нельзя.
 *
 * За время разбирательства по нехватке она получает ровно одно из двух,
 * и оба приходят на планшет: либо новый чек с исправленным составом,
 * либо служебный «клиент отказался». Заходить куда-то и проверять
 * таймер не нужно вовсе.
 *
 * Как это устроено: в Poster заведён товар «‼️ СООБЩЕНИЕ» ценой 0 ₸ в
 * категории напитков. Категория выбрана не случайно — печать в Poster
 * идёт по цехам, и у напитков нет бегунка на кухню: повару служебный
 * чек не уедет, распечатается только кассовый. Нулевая цена не двигает
 * ни выручку, ни средний чек.
 *
 * Ограничение, которое приняли осознанно: служебный чек сам попадает в
 * список входящих, и его тоже нужно закрыть. Два действия вместо одного
 * — цена за то, что сообщение невозможно пропустить.
 */
@Injectable()
export class ServiceReceiptService {
  private readonly logger = new Logger(ServiceReceiptService.name);

  /// Как называется служебный товар в Poster. Ищем по вхождению, чтобы
  /// пережить эмодзи и лишние пробелы в начале названия.
  private static readonly PRODUCT_MARKER = 'СООБЩЕНИЕ';

  constructor(
    private readonly prisma: PrismaService,
    private readonly poster: PosterClient,
  ) {}

  /**
   * Отправляет служебный чек в конкретный отдел.
   *
   * Молча ничего не делает, если товар не заведён: сообщение — побочный
   * канал, и его отсутствие не должно ронять отмену заказа. Но пишет об
   * этом в лог предупреждением, чтобы «почему не приходит» не пришлось
   * выяснять вслепую.
   */
  async send(posterAccountId: string, text: string, phone = '') {
    const account = await this.prisma.posterAccount.findUnique({
      where: { id: posterAccountId },
      select: { id: true, name: true, token: true },
    });
    if (!account) return { sent: false };

    const product = await this.prisma.product.findFirst({
      where: {
        posterAccountId,
        name: { contains: ServiceReceiptService.PRODUCT_MARKER },
        posterId: { not: null },
      },
      select: { posterId: true, name: true },
    });
    if (!product?.posterId) {
      this.logger.warn(
        `Служебный чек для «${account.name}» не отправлен: не найден товар ` +
          `с «${ServiceReceiptService.PRODUCT_MARKER}» в названии`,
      );
      return { sent: false };
    }

    if (process.env.POSTER_DRY_RUN === '1') {
      this.logger.warn(
        `DRY RUN: служебный чек → ${account.name}\n  ${text.replace(/\n/g, '\n  ')}`,
      );
      return { sent: true, dryRun: true };
    }

    try {
      const res = await this.poster.createIncomingOrder(account.token, {
        spot_id: 1,
        phone,
        service_mode: 2, // самовывоз: адрес служебному чеку не нужен
        comment: text,
        products: [{ product_id: Number(product.posterId), count: 1 }],
      });
      this.logger.log(
        `Служебный чек №${res.incoming_order_id} → ${account.name}: ${text.split('\n')[0]}`,
      );
      return { sent: true, incomingOrderId: res.incoming_order_id };
    } catch (e) {
      this.logger.error(`Служебный чек в «${account.name}» не ушёл: ${e}`);
      return { sent: false };
    }
  }
}
