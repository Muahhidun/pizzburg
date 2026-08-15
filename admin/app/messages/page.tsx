'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AdminMessage {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  isPublished: boolean;
  pushSentAt: string | null;
  createdAt: string;
}

/**
 * Лента сообщений: акции, новости, объявления.
 *
 * Рассылка всегда привязана к сообщению ленты — отдельного «просто пуша»
 * нет намеренно: пуш живёт секунды, а клиент должен иметь место, куда
 * вернуться за условиями акции.
 */
export default function MessagesPage() {
  const [items, setItems] = useState<AdminMessage[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sendPush, setSendPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState('');

  const load = useCallback(async () => {
    setItems(await api.get<AdminMessage[]>('/admin/messages'));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  async function create() {
    setBusy(true);
    setError('');
    setReport('');
    try {
      const res = await api.post<{
        message: AdminMessage;
        push: { sent: number; configured: boolean } | null;
      }>('/admin/messages', {
        title: title.trim(),
        body: body.trim(),
        sendPush,
      });
      setTitle('');
      setBody('');
      if (res.push) {
        setReport(
          res.push.configured
            ? `Опубликовано. Пуш ушёл на ${res.push.sent} устройств.`
            : 'Опубликовано. Пуш не настроен на сервере — сообщение только в ленте.',
        );
      } else {
        setReport('Опубликовано в ленте без рассылки.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (m: AdminMessage) =>
    api
      .patch(`/admin/messages/${m.id}`, { isPublished: !m.isPublished })
      .then(load)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  const input =
    'w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15 dark:bg-neutral-800';

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold">Сообщения</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-500">
        Лента в приложении видна всем, включая гостей. Пуш уходит только на
        устройства с установленным новым приложением.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">
          {error}
        </p>
      )}
      {report && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950">
          {report}
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-lg font-semibold">Новое сообщение</h2>
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок — попадёт в пуш"
            className={input}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Текст: условия акции, сроки, подробности"
            rows={4}
            className={input}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendPush}
              onChange={(e) => setSendPush(e.target.checked)}
            />
            Разослать пуш всем устройствам
          </label>
          <button
            onClick={create}
            disabled={busy || title.trim().length < 2 || body.trim().length < 2}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? 'Публикуем…' : sendPush ? 'Опубликовать и разослать' : 'Опубликовать'}
          </button>
        </div>
      </section>

      {items === null ? (
        <p className="mt-6 text-sm text-neutral-500">Загружаем…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">Сообщений пока нет</p>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl border border-black/10 p-4 dark:border-white/15 ${
                m.isPublished ? '' : 'opacity-50'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.title}</span>
                <span className="text-xs text-neutral-500">
                  {new Date(m.createdAt).toLocaleString('ru-RU')}
                </span>
                {m.pushSentAt && (
                  <span className="rounded-md bg-black/5 px-2 py-0.5 text-xs text-neutral-500 dark:bg-white/10">
                    пуш отправлен
                  </span>
                )}
                <button
                  onClick={() => toggle(m)}
                  className="ml-auto rounded-lg px-3 py-1 text-sm text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {m.isPublished ? 'Скрыть из ленты' : 'Вернуть в ленту'}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                {m.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
