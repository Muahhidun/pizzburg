import { REVIEW_QUESTIONS } from './review-form';

export interface ReviewRow {
  rating: number;
  answers: Record<string, string>;
}

export interface QuestionBreakdown {
  id: string;
  label: string;
  /** Сколько раз выбран каждый вариант, в порядке от худшего к лучшему */
  options: { id: string; label: string; count: number; worst: boolean }[];
  answered: number;
  /** Доля худших ответов, % — по ней и видно, что проседает */
  worstPct: number;
}

/**
 * Сводка по отзывам (DECISIONS §12.23).
 *
 * Средняя оценка сама по себе бесполезна: 4,3 не говорит, чинить кухню
 * или доставку. Разбивка по вопросам говорит — и главная в ней доля
 * худших ответов, а не среднее по вопросу: «сильно опоздали» в каждом
 * десятом заказе это провал, даже когда остальные девять довольны.
 */
export function reviewBreakdown(rows: ReviewRow[]): {
  total: number;
  averageRating: number;
  questions: QuestionBreakdown[];
} {
  const total = rows.length;
  const averageRating = total
    ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
    : 0;

  const questions = REVIEW_QUESTIONS.map((question) => {
    const worstWeight = Math.min(...question.options.map((o) => o.weight));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const chosen = row.answers?.[question.id];
      if (chosen) counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    }
    const answered = [...counts.values()].reduce((a, b) => a + b, 0);
    const worstCount = question.options
      .filter((o) => o.weight === worstWeight)
      .reduce((sum, o) => sum + (counts.get(o.id) ?? 0), 0);

    return {
      id: question.id,
      label: question.label,
      answered,
      worstPct: answered ? Math.round((worstCount / answered) * 100) : 0,
      options: question.options.map((o) => ({
        id: o.id,
        label: o.label,
        count: counts.get(o.id) ?? 0,
        worst: o.weight === worstWeight,
      })),
    };
  })
    // Вопросы без единого ответа не показываем: у самовывоза нет
    // курьера, и пустая строка «Курьер — 0» только мешает читать
    .filter((q) => q.answered > 0);

  return { total, averageRating, questions };
}
