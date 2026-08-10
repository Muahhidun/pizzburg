import assert from 'node:assert/strict';
import test from 'node:test';
import { orderStatusNotification } from '../src/notifications/notifications.service';

test('статус READY учитывает доставку и самовывоз', () => {
  assert.deepEqual(orderStatusNotification(42, 'READY', 'PICKUP'), {
    title: 'Заказ №42',
    body: 'Готов к выдаче',
  });
  assert.deepEqual(orderStatusNotification(42, 'READY', 'DELIVERY'), {
    title: 'Заказ №42',
    body: 'Готов и скоро отправится к вам',
  });
});

test('финальные статусы имеют понятный клиенту текст', () => {
  assert.match(orderStatusNotification(7, 'DELIVERED', 'DELIVERY').body, /Доставлен/);
  assert.equal(orderStatusNotification(7, 'CANCELLED', 'DELIVERY').body, 'Отменён');
});
