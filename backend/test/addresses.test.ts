import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressesService } from '../src/auth/addresses.service';

/**
 * Справочник адресов клиента.
 *
 * Главное здесь не CRUD, а два правила: адрес не должен размножаться
 * дублями при каждом заказе, и уточнения (подъезд, этаж) не должны
 * стираться пустыми значениями следующего заказа.
 */
function serviceWith() {
  const calls: Record<string, unknown>[] = [];
  const prisma = {
    customerAddress: {
      upsert: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { id: 'a1' };
      },
      findMany: async () => [],
    },
  };
  return { service: new AddressesService(prisma as never), calls };
}

test('адрес без улицы или дома не запоминается', async () => {
  const { service, calls } = serviceWith();

  assert.equal(
    await service.remember('t1', 'c1', { street: '', house: '12' }),
    null,
  );
  assert.equal(
    await service.remember('t1', 'c1', { street: 'Абая', house: '  ' }),
    null,
  );
  assert.equal(calls.length, 0);
});

test('квартира «не указана» — пустая строка, иначе ключ дубликата не сработает', async () => {
  const { service, calls } = serviceWith();

  await service.remember('t1', 'c1', { street: 'Абая', house: '12' });

  const where = calls[0].where as Record<string, Record<string, unknown>>;
  assert.equal(where.customerId_street_house_flat.flat, '');
  assert.equal(where.customerId_street_house_flat.street, 'Абая');
});

test('лишние пробелы не создают второй «такой же» адрес', async () => {
  const { service, calls } = serviceWith();

  await service.remember('t1', 'c1', {
    street: '  Абая  ',
    house: ' 12 ',
    flat: ' 5 ',
  });

  const where = calls[0].where as Record<string, Record<string, unknown>>;
  assert.deepEqual(where.customerId_street_house_flat, {
    customerId: 'c1',
    street: 'Абая',
    house: '12',
    flat: '5',
  });
});

test('пустой подъезд не стирает сохранённый', async () => {
  const { service, calls } = serviceWith();

  await service.remember('t1', 'c1', {
    street: 'Абая',
    house: '12',
    entrance: '',
    floor: '3',
  });

  const update = calls[0].update as Record<string, unknown>;
  assert.ok(!('entrance' in update), 'пустой подъезд не должен попадать в update');
  assert.equal(update.floor, '3');
  assert.ok(update.lastUsedAt instanceof Date);
});

test('повторный заказ поднимает адрес наверх списка', async () => {
  const { service, calls } = serviceWith();

  await service.remember('t1', 'c1', { street: 'Абая', house: '12' });

  const update = calls[0].update as Record<string, unknown>;
  assert.ok(update.lastUsedAt instanceof Date);
});
