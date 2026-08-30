import assert from 'node:assert/strict';
import test from 'node:test';
import { AvailabilityService } from '../src/availability/availability.service';

const availability = new AvailabilityService();

/** Будни 10:00–22:00 в поясе заведения */
const weekdaySchedule = {
  timezone: 'Asia/Almaty',
  schedule: {
    profiles: [
      {
        id: 'base',
        name: 'Рабочее время',
        hours: {
          mon: [['10:00', '22:00']],
          tue: [['10:00', '22:00']],
          wed: [['10:00', '22:00']],
          thu: [['10:00', '22:00']],
          fri: [['10:00', '22:00']],
          sat: [['10:00', '22:00']],
          sun: [['10:00', '22:00']],
        },
      },
    ],
  },
};

// 2026-08-13 — четверг. UTC+5, поэтому 09:00 UTC = 14:00 в Экибастузе.
const thursdayAfternoon = new Date('2026-08-13T09:00:00Z');
const thursdayNight = new Date('2026-08-13T20:00:00Z'); // 01:00 по местному

test('расписание считается в часовом поясе заведения, а не сервера', () => {
  const open = availability.getState(weekdaySchedule, thursdayAfternoon);
  assert.equal(open.isOpenNow, true);
  assert.equal(open.scheduleProfile, 'Рабочее время');

  // 01:00 по местному — закрыто, хотя по UTC ещё «вечер предыдущего дня»
  const closed = availability.getState(weekdaySchedule, thursdayNight);
  assert.equal(closed.isOpenNow, false);
});

test('пустое расписание не закрывает нового арендатора', () => {
  const state = availability.getState({}, thursdayNight);
  assert.equal(state.isOpenNow, true);
  assert.equal(state.deliveryAvailable, true);
});

test('режим «только самовывоз» убирает доставку, но оставляет приём', () => {
  const state = availability.getState(
    { ...weekdaySchedule, ordering: { mode: 'PICKUP_ONLY' } },
    thursdayAfternoon,
  );
  assert.equal(state.deliveryAvailable, false);
  assert.equal(state.pickupAvailable, true);
  assert.match(state.message ?? '', /самовывоз/i);

  assert.throws(
    () =>
      availability.assertOrderAllowed(
        { ...weekdaySchedule, ordering: { mode: 'PICKUP_ONLY' } },
        { type: 'DELIVERY', paymentMethod: 'CASH' },
        thursdayAfternoon,
      ),
    /Доставка сейчас недоступна|самовывоз/i,
  );
});

test('режим CLOSED запрещает и доставку, и самовывоз', () => {
  const settings = { ...weekdaySchedule, ordering: { mode: 'CLOSED' } };
  const state = availability.getState(settings, thursdayAfternoon);
  assert.equal(state.deliveryAvailable, false);
  assert.equal(state.pickupAvailable, false);

  assert.throws(
    () =>
      availability.assertOrderAllowed(
        settings,
        { type: 'PICKUP', paymentMethod: 'CASH' },
        thursdayAfternoon,
      ),
    /приостановлен/i,
  );
});

test('временная остановка снимается точно по сроку', () => {
  const until = new Date(thursdayAfternoon.getTime() + 30 * 60_000);
  const settings = {
    ...weekdaySchedule,
    ordering: { mode: 'CLOSED', until: until.toISOString() },
  };
  const active = availability.getState(settings, thursdayAfternoon);
  assert.equal(active.mode, 'CLOSED');
  assert.equal(active.orderingUntil, until.toISOString());

  const expired = availability.getState(
    settings,
    new Date(until.getTime() + 1),
  );
  assert.equal(expired.mode, 'ALL');
  assert.equal(expired.orderingUntil, null);
});

test('профиль с датами перекрывает базовое расписание', () => {
  const ramadan = {
    ...weekdaySchedule,
    schedule: {
      profiles: [
        ...weekdaySchedule.schedule.profiles,
        {
          id: 'ramadan',
          name: 'Рамадан',
          activeFrom: '2026-08-01',
          activeTo: '2026-08-30',
          hours: { thu: [['18:00', '23:00']] },
        },
      ],
    },
  };

  // 14:00 по местному в августе — по Рамадану ещё закрыто
  const state = availability.getState(ramadan, thursdayAfternoon);
  assert.equal(state.scheduleProfile, 'Рамадан');
  assert.equal(state.isOpenNow, false);

  // 19:00 по местному (14:00 UTC) — уже открыто
  const evening = availability.getState(ramadan, new Date('2026-08-13T14:00:00Z'));
  assert.equal(evening.isOpenNow, true);
});

test('«как можно быстрее» отключается перед самым закрытием', () => {
  // 21:58 по местному = 16:58 UTC, закрытие в 22:00, порог 3 минуты
  const state = availability.getState(
    weekdaySchedule,
    new Date('2026-08-13T16:58:00Z'),
  );
  assert.equal(state.isOpenNow, true);
  assert.equal(state.asapAvailable, false);

  assert.throws(
    () =>
      availability.assertOrderAllowed(
        weekdaySchedule,
        { type: 'PICKUP', paymentMethod: 'CASH' },
        new Date('2026-08-13T16:58:00Z'),
      ),
    /закрыти/i,
  );
});

test('выключенный способ оплаты не проходит на сервере', () => {
  const settings = {
    ...weekdaySchedule,
    payments: { cash: false, cardOnDelivery: true },
  };
  assert.throws(
    () =>
      availability.assertOrderAllowed(
        settings,
        { type: 'PICKUP', paymentMethod: 'CASH' },
        thursdayAfternoon,
      ),
    /способ оплаты/i,
  );
});

test('предзаказ уважает минимальный срок и часы работы', () => {
  const now = thursdayAfternoon; // 14:00 по местному

  // через 10 минут — раньше 90-минутного порога доставки
  assert.throws(
    () =>
      availability.assertOrderAllowed(
        weekdaySchedule,
        {
          type: 'DELIVERY',
          paymentMethod: 'CASH',
          scheduledAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
        },
        now,
      ),
    /Ближайшее время/i,
  );

  // через 2 часа — 16:00 по местному, рабочее время
  assert.doesNotThrow(() =>
    availability.assertOrderAllowed(
      weekdaySchedule,
      {
        type: 'DELIVERY',
        paymentMethod: 'CASH',
        scheduledAt: new Date(now.getTime() + 120 * 60_000).toISOString(),
      },
      now,
    ),
  );

  // через 12 часов — 02:00 по местному, заведение закрыто
  assert.throws(
    () =>
      availability.assertOrderAllowed(
        weekdaySchedule,
        {
          type: 'DELIVERY',
          paymentMethod: 'CASH',
          scheduledAt: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(),
        },
        now,
      ),
    /закрыт/i,
  );
});

test('закрытое заведение принимает предзаказ, но не «как можно быстрее»', () => {
  // 01:00 по местному, работаем с 10:00
  assert.throws(
    () =>
      availability.assertOrderAllowed(
        weekdaySchedule,
        { type: 'PICKUP', paymentMethod: 'CASH' },
        thursdayNight,
      ),
    /выберите время предзаказа/i,
  );

  // предзаказ на 12:00 того же дня проходит
  const noon = new Date('2026-08-14T07:00:00Z'); // 12:00 местного
  assert.doesNotThrow(() =>
    availability.assertOrderAllowed(
      weekdaySchedule,
      {
        type: 'PICKUP',
        paymentMethod: 'CASH',
        scheduledAt: noon.toISOString(),
      },
      thursdayNight,
    ),
  );
});

test('слоты предзаказа попадают только в рабочие часы', () => {
  const slots = availability.slots(weekdaySchedule, 'PICKUP', thursdayNight);
  assert.ok(slots.length > 0, 'слоты должны быть');
  for (const slot of slots.slice(0, 20)) {
    const state = availability.getState(weekdaySchedule, new Date(slot.at));
    assert.equal(state.isOpenNow, true, `слот ${slot.label} вне рабочих часов`);
  }
});

// ─── Высокий спрос (DECISIONS §12.17) ────────────────────────────

/** Наплыв, поставленный за полчаса до `thursdayAfternoon` на час */
const rushLive = {
  ...weekdaySchedule,
  rush: { extraMinutes: 40, until: '2026-08-13T09:30:00Z' },
};

/** Тот же наплыв, но срок уже прошёл */
const rushStale = {
  ...weekdaySchedule,
  rush: { extraMinutes: 40, until: '2026-08-13T08:30:00Z' },
};

test('наплыв добавляет минуты к сроку и объясняет это словами', () => {
  const state = availability.getState(rushLive, thursdayAfternoon);

  assert.equal(state.rushExtraMinutes, 40);
  assert.match(state.rushNotice ?? '', /35–40 минут/);
  // Число клиенту не показываем — только готовую фразу
  assert.doesNotMatch(state.rushNotice ?? '', /\+40/);

  // Заказы всё равно принимаем: наплыв — это не закрытие
  assert.equal(state.isOpenNow, true);
  assert.equal(state.deliveryAvailable, true);
});

test('просроченный наплыв не доживает до следующего запроса', () => {
  const state = availability.getState(rushStale, thursdayAfternoon);

  // Даже если фоновая задача не сработала, срок решает всё
  assert.equal(state.rushExtraMinutes, 0);
  assert.equal(state.rushNotice, null);
  assert.equal(state.rushUntil, null);
});

test('наплыв отодвигает ближайшее время, но не портит настройки', () => {
  const calm = availability.getState(weekdaySchedule, thursdayAfternoon);
  const busy = availability.getState(rushLive, thursdayAfternoon);

  assert.equal(
    availability.leadMinutes(busy, 'DELIVERY'),
    availability.leadMinutes(calm, 'DELIVERY') + 40,
  );
  assert.equal(
    availability.leadMinutes(busy, 'PICKUP'),
    availability.leadMinutes(calm, 'PICKUP') + 40,
  );

  // Настройки предзаказа при этом остаются прежними: добавка живёт час,
  // а они заданы владельцем однажды
  assert.equal(
    busy.preorder.deliveryLeadMinutes,
    calm.preorder.deliveryLeadMinutes,
  );
});

test('первый слот предзаказа сдвигается на время наплыва', () => {
  const calm = availability.slots(weekdaySchedule, 'DELIVERY', thursdayAfternoon);
  const busy = availability.slots(rushLive, 'DELIVERY', thursdayAfternoon);

  assert.ok(calm.length > 0 && busy.length > 0);
  const shift =
    new Date(busy[0].at).getTime() - new Date(calm[0].at).getTime();
  // Слоты округляются вверх до шага, поэтому сдвиг не меньше добавки
  assert.ok(shift >= 40 * 60_000 - 1, `сдвиг оказался ${shift / 60_000} мин`);
});
