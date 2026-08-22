'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessagesReport, ReviewsReport, api } from '@/lib/api';

/**
 * Отзывы и обращения (DECISIONS §12.23, §12.21).
 *
 * Сводка стоит над лентой, а не отдельной страницей: цифра без примеров
 * ничего не объясняет, а примеры без цифры не показывают, единичный это
 * случай или система.
 */
export default function FeedbackPage() {
  const [tab, setTab] = useState<'reviews' | 'messages'>('reviews');
  const [reviews, setReviews] = useState<ReviewsReport | null>(null);
  const [messages, setMessages] = useState<MessagesReport | null>(null);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      api.get<ReviewsReport>('/admin/reviews'),
      api.get<MessagesReport>('/admin/order-messages'),
    ]);
    setReviews(r);
    setMessages(m);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!reviews || !messages) {
    return <p className="text-neutral-500">Загрузка…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Обратная связь</h1>
        <p className="text-sm text-neutral-500">
          За последние 30 дней. Отзывы клиенты нигде не видят — они только
          для нас.
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            ['reviews', `Отзывы · ${reviews.total}`],
            ['messages', `Обращения · ${messages.total}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === id
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'border border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reviews' ? (
        <Reviews report={reviews} />
      ) : (
        <Messages report={messages} />
      )}
    </div>
  );
}

function Reviews({ report }: { report: ReviewsReport }) {
  if (report.total === 0) {
    return (
      <Card>
        <p className="text-sm text-neutral-500">
          Отзывов пока нет. Анкета приходит через 2,5 часа после заказа.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-bold">{report.averageRating}</span>
          <span className="text-sm text-neutral-500">
            средняя из 5 · {report.total} отзывов
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {report.questions.map((q) => (
            <div key={q.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{q.label}</span>
                {/* Доля худших ответов — то, ради чего вся сводка:
                    средняя 4,9 скрывает, что каждому десятому опоздали */}
                {q.worstPct > 0 && (
                  <span className="text-sm font-semibold text-red-600">
                    {q.worstPct}% — хуже некуда
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <span
                    key={o.id}
                    className={`rounded-lg px-2 py-1 text-xs ${
                      o.count === 0
                        ? 'text-neutral-400'
                        : o.worst
                          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : 'bg-black/5 dark:bg-white/10'
                    }`}
                  >
                    {o.label} · {o.count}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {report.items.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">
              {r.rating}/5{' '}
              <span className="font-normal text-neutral-500">
                №{r.orderNumber} ·{' '}
                {r.orderType === 'DELIVERY' ? 'доставка' : 'самовывоз'}
              </span>
            </span>
            <span className="text-xs text-neutral-500">
              {when(r.createdAt)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(r.answers).map(([qid, oid]) => (
              <Answer key={qid} report={report} qid={qid} oid={oid} />
            ))}
          </div>

          {r.text && <p className="mt-2 text-sm">«{r.text}»</p>}

          <p className="mt-2 text-xs text-neutral-500">
            {r.customerName ?? 'Без имени'} · {r.customerPhone ?? '—'}
          </p>

          <Reply
            at={r.answeredAt}
            by={r.answeredBy}
            text={r.answerText}
            pending={r.alerted}
          />
        </Card>
      ))}
    </>
  );
}

/** Код ответа переводим в слова по той же анкете, что видел клиент */
function Answer({
  report,
  qid,
  oid,
}: {
  report: ReviewsReport;
  qid: string;
  oid: string;
}) {
  const question = report.questions.find((q) => q.id === qid);
  const option = question?.options.find((o) => o.id === oid);
  if (!question || !option) return null;
  return (
    <span
      className={`rounded-lg px-2 py-1 text-xs ${
        option.worst
          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      {question.label} — {option.label}
    </span>
  );
}

function Messages({ report }: { report: MessagesReport }) {
  if (report.total === 0) {
    return (
      <Card>
        <p className="text-sm text-neutral-500">
          Обращений нет. Кнопка «Написать нам» живёт на экране заказа, пока
          заказ не закрыт.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap gap-2">
          {Object.entries(report.byTopic)
            .sort((a, b) => b[1] - a[1])
            .map(([topic, count]) => (
              <span
                key={topic}
                className="rounded-lg bg-black/5 px-2.5 py-1 text-sm dark:bg-white/10"
              >
                {report.topics[topic] ?? topic} · {count}
              </span>
            ))}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Чаще всего повторяющаяся тема — подсказка, что чинить в
          приложении, а не только в смене.
        </p>
      </Card>

      {report.items.map((m) => (
        <Card key={m.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">
              {m.label}{' '}
              <span className="font-normal text-neutral-500">
                №{m.orderNumber}
              </span>
            </span>
            <span className="text-xs text-neutral-500">
              {when(m.createdAt)}
            </span>
          </div>
          {m.text && <p className="mt-2 text-sm">«{m.text}»</p>}
          <p className="mt-2 text-xs text-neutral-500">
            {m.customerName ?? 'Без имени'} · {m.customerPhone ?? '—'}
          </p>
          <Reply
            at={m.answeredAt}
            by={m.answeredBy}
            text={m.answerText}
            pending
          />
        </Card>
      ))}
    </>
  );
}

/**
 * Ответ заведения.
 *
 * Отвечать пока нечем — механизм будет отдельной задачей, — но место
 * показываем сразу: без него по ленте не понять, разобрались с человеком
 * или он до сих пор ждёт.
 */
function Reply({
  at,
  by,
  text,
  pending,
}: {
  at: string | null;
  by: string | null;
  text: string | null;
  pending: boolean;
}) {
  if (at) {
    return (
      <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950">
        <span className="text-emerald-700 dark:text-emerald-300">
          Ответили{by ? ` · ${by}` : ''} · {when(at)}
        </span>
        {text && <p className="mt-1">{text}</p>}
      </div>
    );
  }
  if (!pending) return null;
  return (
    <p className="mt-3 text-xs text-neutral-400">Ответа не было</p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
      {children}
    </div>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
