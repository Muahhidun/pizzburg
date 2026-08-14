'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatTenge } from '@/lib/api';

type DocType = 'OFFER' | 'PRIVACY' | 'REQUISITES';

interface LegalDoc {
  type: DocType;
  version: number;
  title: string;
  content: string;
  publishedAt: string;
}

interface HistoryItem {
  id: string;
  version: number;
  title: string;
  isCurrent: boolean;
  publishedAt: string;
}

interface LegalResponse {
  current: LegalDoc[];
  history: Record<DocType, HistoryItem[]>;
}

interface CancelReason {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  availableToCustomer: boolean;
}

interface CancellationReport {
  from: string;
  to: string;
  total: number;
  lostAmount: number;
  byReason: { label: string; count: number; amount: number }[];
  byWho: Record<string, number>;
}

const DOC_LABELS: Record<DocType, { title: string; hint: string }> = {
  OFFER: {
    title: 'Публичная оферта',
    hint: 'Условия заказа и доставки. Клиент соглашается при оформлении.',
  },
  PRIVACY: {
    title: 'Политика конфиденциальности',
    hint: 'Обязательна для ревью App Store и Google Play.',
  },
  REQUISITES: {
    title: 'Реквизиты',
    hint: 'Название юрлица, БИН, адрес, контакты. Согласия не требует.',
  },
};

const WHO_LABELS: Record<string, string> = {
  CUSTOMER: 'клиент',
  ADMIN: 'оператор',
  POSTER: 'касса',
  UNKNOWN: 'не указано',
};

export default function LegalPage() {
  const [legal, setLegal] = useState<LegalResponse | null>(null);
  const [reasons, setReasons] = useState<CancelReason[] | null>(null);
  const [report, setReport] = useState<CancellationReport | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const [l, r, rep] = await Promise.all([
      api.get<LegalResponse>('/admin/legal'),
      api.get<CancelReason[]>('/admin/cancel-reasons'),
      api.get<CancellationReport>('/admin/reports/cancellations'),
    ]);
    setLegal(l);
    setReasons(r);
    setReport(rep);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  if (!legal || !reasons) return <p className="text-neutral-500">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Документы и отмены</h1>
        <p className="text-sm text-neutral-500">
          Оферта и политика нужны для публикации в сторах. Причины отмены — для
          отчёта.
        </p>
      </div>

      {(['OFFER', 'PRIVACY', 'REQUISITES'] as DocType[]).map((type) => (
        <DocumentCard
          key={type}
          type={type}
          current={legal.current.find((d) => d.type === type) ?? null}
          history={legal.history[type] ?? []}
          onSaved={async (msg) => {
            await load();
            flash(msg);
          }}
        />
      ))}

      <ReasonsCard
        reasons={reasons}
        onChanged={async (msg) => {
          await load();
          flash(msg);
        }}
      />

      {report && <ReportCard report={report} />}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-black">
          {toast}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  type,
  current,
  history,
  onSaved,
}: {
  type: DocType;
  current: LegalDoc | null;
  history: HistoryItem[];
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(current?.title ?? DOC_LABELS[type].title);
  const [content, setContent] = useState(current?.content ?? '');
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    setBusy(true);
    try {
      await api.post('/admin/legal', { type, title, content });
      setOpen(false);
      onSaved(`Опубликована новая редакция: ${DOC_LABELS[type].title}`);
    } catch (e) {
      onSaved((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{DOC_LABELS[type].title}</h2>
          <p className="text-sm text-neutral-500">{DOC_LABELS[type].hint}</p>
        </div>
        <div className="flex items-center gap-2">
          {current ? (
            <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              опубликован · ред. {current.version}
            </span>
          ) : (
            <span className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              не опубликован
            </span>
          )}
          <button
            onClick={() => {
              setTitle(current?.title ?? DOC_LABELS[type].title);
              setContent(current?.content ?? '');
              setOpen(!open);
            }}
            className="rounded-xl border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
          >
            {open ? 'Свернуть' : current ? 'Новая редакция' : 'Опубликовать'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок документа"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            placeholder="Текст документа (поддерживается Markdown)"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/15"
          />
          <p className="text-xs text-neutral-400">
            Публикация создаёт новую версию, предыдущая сохраняется в истории.
            Для оферты и политики согласие клиентов будет запрошено заново.
          </p>
          <button
            onClick={publish}
            disabled={busy || content.trim().length < 10}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? 'Публикуем…' : 'Опубликовать редакцию'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3 border-t border-black/5 pt-3 text-sm dark:border-white/10">
          <div className="mb-1 text-xs text-neutral-500">История</div>
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="flex items-center gap-2 py-0.5">
              <span className="w-14 shrink-0 text-neutral-400">ред. {h.version}</span>
              <span className="min-w-0 flex-1 truncate">{h.title}</span>
              <span className="shrink-0 text-neutral-400">
                {new Date(h.publishedAt).toLocaleDateString('ru-RU')}
              </span>
              {h.isCurrent && (
                <span className="shrink-0 text-xs text-emerald-600">текущая</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReasonsCard({
  reasons,
  onChanged,
}: {
  reasons: CancelReason[];
  onChanged: (message: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [forCustomer, setForCustomer] = useState(false);

  const add = async () => {
    if (label.trim().length < 2) return;
    try {
      await api.post('/admin/cancel-reasons', {
        label: label.trim(),
        availableToCustomer: forCustomer,
      });
      setLabel('');
      setForCustomer(false);
      onChanged('Причина добавлена');
    } catch (e) {
      onChanged((e as Error).message);
    }
  };

  const patch = async (id: string, data: Partial<CancelReason>, msg: string) => {
    await api.patch(`/admin/cancel-reasons/${id}`, data);
    onChanged(msg);
  };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
      <h2 className="font-semibold">Причины отмены</h2>
      <p className="mb-3 text-sm text-neutral-500">
        «Доступна клиенту» — причина появится в приложении. Служебные вроде «нет
        курьеров» клиенту показывать не стоит.
      </p>

      <ul className="space-y-1.5">
        {reasons.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/5"
          >
            <span
              className={`min-w-0 flex-1 ${r.isActive ? '' : 'text-neutral-400 line-through'}`}
            >
              {r.label}
            </span>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={r.availableToCustomer}
                onChange={(e) =>
                  patch(
                    r.id,
                    { availableToCustomer: e.target.checked },
                    'Сохранено',
                  )
                }
              />
              доступна клиенту
            </label>
            <button
              onClick={() =>
                patch(
                  r.id,
                  { isActive: !r.isActive },
                  r.isActive ? 'Причина выключена' : 'Причина включена',
                )
              }
              className="shrink-0 text-xs text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            >
              {r.isActive ? 'выключить' : 'включить'}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Новая причина"
          className="min-w-[200px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={forCustomer}
            onChange={(e) => setForCustomer(e.target.checked)}
          />
          доступна клиенту
        </label>
        <button
          onClick={add}
          className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Добавить
        </button>
      </div>
    </section>
  );
}

function ReportCard({ report }: { report: CancellationReport }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-neutral-900">
      <h2 className="font-semibold">Отмены за 30 дней</h2>
      <p className="mb-3 text-sm text-neutral-500">
        {report.total} отмен на {formatTenge(report.lostAmount)} — это выручка,
        которая не дошла.
      </p>

      {report.total === 0 ? (
        <p className="text-sm text-neutral-400">Отмен за период не было</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {report.byReason.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="shrink-0 font-medium">{r.count}</span>
                <span className="w-28 shrink-0 text-right text-neutral-500">
                  {formatTenge(r.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-3 text-sm dark:border-white/10">
            {Object.entries(report.byWho).map(([who, count]) => (
              <span
                key={who}
                className="rounded-lg bg-black/5 px-2.5 py-1 dark:bg-white/10"
              >
                {WHO_LABELS[who] ?? who}: <b>{count}</b>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
