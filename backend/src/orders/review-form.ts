/**
 * Анкета о заказе (DECISIONS §12.23).
 *
 * Спрашиваем факты, а не оценку. Прямые звёзды дают либо пять, либо
 * один: человек не хочет выносить приговор и уходит в крайности, а
 * средних значений в такой шкале почти не бывает. «Еда была горячей?»
 * ответить легко, и по ответу сразу видно, что чинить.
 *
 * Порядок вариантов — от худшего к лучшему, `weight` от 1 до 5. Общая
 * оценка — среднее по отвеченным вопросам, поэтому шкалы разной длины
 * сравнимы между собой.
 */
export interface ReviewOption {
  id: string;
  label: string;
  /// Казахская формулировка. Пусто — покажем русскую (DECISIONS §12.30).
  labelKk?: string;
  weight: number;
}

export interface ReviewQuestion {
  id: string;
  label: string;
  labelKk?: string;
  /** Только для доставки: у самовывоза курьера нет */
  deliveryOnly?: boolean;
  options: ReviewOption[];
}

export const REVIEW_QUESTIONS: ReviewQuestion[] = [
  {
    id: 'timing',
    label: 'Успели вовремя?', labelKk: 'Уақытында үлгердік пе?',
    options: [
      { id: 'VERY_LATE', label: 'Сильно опоздали', labelKk: 'Қатты кешіктік', weight: 1 },
      { id: 'LATE', label: 'Чуть дольше', labelKk: 'Сәл ұзағырақ', weight: 3 },
      { id: 'ON_TIME', label: 'Вовремя', labelKk: 'Уақытында', weight: 5 },
      { id: 'EARLY', label: 'Даже раньше', labelKk: 'Тіпті ертерек', weight: 5 },
    ],
  },
  {
    id: 'complete',
    label: 'Всё привезли?', labelKk: 'Бәрін әкелдік пе?',
    options: [
      { id: 'MISSING', label: 'Кое-чего не было', labelKk: 'Бірдеңе жетіспеді', weight: 1 },
      { id: 'FULL', label: 'Да, всё на месте', labelKk: 'Иә, бәрі орнында', weight: 5 },
    ],
  },
  {
    id: 'temperature',
    label: 'Еда была горячей?', labelKk: 'Тамақ ыстық болды ма?',
    options: [
      { id: 'COLD', label: 'Холодная', labelKk: 'Суық', weight: 1 },
      { id: 'WARM', label: 'Тёплая', labelKk: 'Жылы', weight: 3 },
      { id: 'HOT', label: 'Горячая', labelKk: 'Ыстық', weight: 5 },
    ],
  },
  {
    id: 'taste',
    label: 'Вкус', labelKk: 'Дәмі',
    options: [
      { id: 'BAD', label: 'Не понравилось', labelKk: 'Ұнамады', weight: 1 },
      { id: 'OK', label: 'Обычно', labelKk: 'Әдеттегідей', weight: 3 },
      { id: 'GOOD', label: 'Понравилось', labelKk: 'Ұнады', weight: 4 },
      { id: 'GREAT', label: 'Очень', labelKk: 'Өте', weight: 5 },
    ],
  },
  {
    id: 'courier',
    label: 'Курьер', labelKk: 'Курьер',
    deliveryOnly: true,
    options: [
      { id: 'RUDE', label: 'Было неприятно', labelKk: 'Жағымсыз болды', weight: 1 },
      { id: 'NORMAL', label: 'Обычно', labelKk: 'Әдеттегідей', weight: 4 },
      { id: 'POLITE', label: 'Вежливый', labelKk: 'Сыпайы', weight: 5 },
    ],
  },
];

export function questionsFor(type: 'DELIVERY' | 'PICKUP') {
  return REVIEW_QUESTIONS.filter(
    (q) => type === 'DELIVERY' || !q.deliveryOnly,
  );
}

export interface ScoredReview {
  rating: number;
  /** Есть ли ответ «хуже некуда» — по нему решаем, будить ли смену */
  hasWorst: boolean;
  /** Человекочитаемые ответы для сообщения в чат */
  lines: string[];
}

/**
 * Оценка из ответов.
 *
 * Среднее по отвеченным, а не сумма: человек вправе пропустить вопрос,
 * и пропуск не должен занижать оценку. Отдельно возвращаем признак
 * «хуже некуда» — именно он, а не средняя оценка, решает, поднимать ли
 * смену: заказ с четырьмя пятёрками и забытым соусом даёт хорошее
 * среднее, а соус всё равно надо привезти.
 */
export function scoreReview(
  answers: Record<string, string>,
  type: 'DELIVERY' | 'PICKUP',
): ScoredReview {
  const questions = questionsFor(type);
  const weights: number[] = [];
  const lines: string[] = [];
  let hasWorst = false;

  for (const question of questions) {
    const chosen = question.options.find((o) => o.id === answers[question.id]);
    if (!chosen) continue;
    weights.push(chosen.weight);
    lines.push(`${question.label} — ${chosen.label}`);
    const worst = Math.min(...question.options.map((o) => o.weight));
    if (chosen.weight === worst) hasWorst = true;
  }

  const rating = weights.length
    ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length)
    : 0;

  return { rating, hasWorst, lines };
}
