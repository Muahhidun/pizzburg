/**
 * Сроки стоп-листа (DECISIONS §12.3).
 *
 * Срок обязателен, и в этом весь смысл механики: кассир ставит позицию
 * «на два часа» и забывает вернуть — стоп тянется, продавать уже можно, а
 * выручка теряется. У стопа в Poster срока нет и добавить его туда
 * нельзя, поэтому свой стоп без срока не имеет смысла заводить вовсе.
 *
 * Вынесено без зависимостей: арифметика по расписанию — то место, где
 * ошибка возвращает позицию посреди ночи или через сутки.
 */

export type StopPreset = 'HOUR' | 'TWO_HOURS' | 'END_OF_DAY' | 'NEXT_SHIFT';

export const STOP_PRESETS: { value: StopPreset; label: string }[] = [
  { value: 'HOUR', label: 'На час' },
  { value: 'TWO_HOURS', label: 'На два часа' },
  { value: 'END_OF_DAY', label: 'До конца дня' },
  { value: 'NEXT_SHIFT', label: 'До следующей смены' },
];

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

export interface ScheduleLookup {
  /** Минут от полуночи по местному времени прямо сейчас */
  nowMinutes: number;
  /** Часы работы на день со смещением `daysAhead` от сегодняшнего */
  hoursOn: (daysAhead: number) => [string, string][];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Во сколько позиция вернётся в продажу.
 *
 * Считаем в минутах от «сейчас», а не собираем дату из частей: в этом
 * случае не нужно переводить местное время в UTC руками. Казахстан не
 * переводит часы, поэтому сутки ровно 1440 минут — на этом расчёт и
 * держится.
 */
export function stopDeadline(
  preset: StopPreset,
  schedule: ScheduleLookup,
  now = new Date(),
): Date {
  if (preset === 'HOUR') return new Date(now.getTime() + 60 * MINUTE);
  if (preset === 'TWO_HOURS') return new Date(now.getTime() + 120 * MINUTE);

  if (preset === 'END_OF_DAY') {
    const today = schedule.hoursOn(0);
    const closing = today.length
      ? Math.max(...today.map(([, to]) => toMinutes(to)))
      : DAY_MINUTES;
    // Смена уже закрылась (или расписания нет и сутки на исходе) — держать
    // стоп до вчерашнего времени бессмысленно, ведём до следующей смены.
    if (closing > schedule.nowMinutes) {
      return new Date(now.getTime() + (closing - schedule.nowMinutes) * MINUTE);
    }
    return stopDeadline('NEXT_SHIFT', schedule, now);
  }

  // NEXT_SHIFT — открытие ближайшего рабочего дня впереди
  for (let day = 1; day <= 7; day++) {
    const hours = schedule.hoursOn(day);
    if (hours.length === 0) continue;
    const opening = Math.min(...hours.map(([from]) => toMinutes(from)));
    const minutes = day * DAY_MINUTES - schedule.nowMinutes + opening;
    return new Date(now.getTime() + minutes * MINUTE);
  }

  // Расписания нет вовсе — считаем сменой начало следующих суток
  return new Date(
    now.getTime() + (DAY_MINUTES - schedule.nowMinutes) * MINUTE,
  );
}
