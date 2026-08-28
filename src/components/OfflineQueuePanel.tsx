import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listQueue, onQueueChanged, retryQueueItem, removeFromQueue, type QueueItem } from '../lib/offlineQueue'

const QUEUE_STATUS_LABELS: Record<QueueItem['status'], string> = {
  pending: 'Ожидает загрузки',
  uploading: 'Загрузка…',
  uploaded: 'Загружено',
  error: 'Ошибка загрузки',
}

const QUEUE_STATUS_COLOR: Record<QueueItem['status'], string> = {
  pending: 'text-[var(--color-stamp)]',
  uploading: 'text-[var(--color-accent)]',
  uploaded: 'text-[var(--color-ok)]',
  error: 'text-[var(--color-danger)]',
}

/** Показывает документы, ожидающие/загружающиеся из офлайн-очереди.
 *  Ничего не рендерит, если очередь пуста (и не было ошибок), чтобы не
 *  занимать место на экранах, когда всё уже загружено. */
export default function OfflineQueuePanel() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [items, setItems] = useState<QueueItem[]>([])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = () => {
      listQueue(userId).then((all) => {
        if (!cancelled) setItems(all.filter((i) => i.status !== 'uploaded'))
      })
    }
    load()
    const unsubscribe = onQueueChanged(load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [userId])

  if (!userId || items.length === 0) return null

  return (
    <div className="mb-4 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm text-[var(--color-ink)]">
              Накладная · {item.pages.length} стр.
            </p>
            <p className={`text-xs font-medium ${QUEUE_STATUS_COLOR[item.status]}`}>
              {QUEUE_STATUS_LABELS[item.status]}
              {item.status === 'error' && item.error ? ` — ${item.error}` : ''}
            </p>
          </div>
          {item.status === 'error' && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => retryQueueItem(item.id, userId)}
                className="rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-[var(--color-paper)]"
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={() => removeFromQueue(item.id)}
                className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-soft)]"
              >
                Удалить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
