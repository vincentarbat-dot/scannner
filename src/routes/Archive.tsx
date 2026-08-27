import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS, type DocumentStatus, type InvoiceDocument } from '../types'
import OfflineQueuePanel from '../components/OfflineQueuePanel'

const PAGE_SIZE = 20
const STATUS_FILTERS: Array<{ value: DocumentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'new', label: STATUS_LABELS.new },
  { value: 'reviewed', label: STATUS_LABELS.reviewed },
  { value: 'sent_to_accounting', label: STATUS_LABELS.sent_to_accounting },
  { value: 'processed', label: STATUS_LABELS.processed },
  { value: 'archived', label: STATUS_LABELS.archived },
]

export default function Archive() {
  const [docs, setDocs] = useState<InvoiceDocument[]>([])
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (targetStatus: DocumentStatus | 'all', targetPage: number) => {
    setLoading(true)
    setError(null)
    const from = targetPage * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase.from('documents').select('*').order('created_at', { ascending: false }).range(from, to)
    if (targetStatus !== 'all') query = query.eq('status', targetStatus)

    const { data, error: queryError } = await query
    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }
    const rows = (data as InvoiceDocument[]) ?? []
    setDocs((prev) => (targetPage === 0 ? rows : [...prev, ...rows]))
    setHasMore(rows.length === PAGE_SIZE)
    setLoading(false)
  }, [])

  useEffect(() => {
    setPage(0)
    load(status, 0)
  }, [status, load])

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    load(status, next)
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <h1 className="font-display text-2xl text-[var(--color-ink)]">Архив</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        Дата, поставщик, номер, сумма, статус, страницы, QR и качество — на каждой карточке.
      </p>

      <div className="mt-4">
        <OfflineQueuePanel />
      </div>

      {/* Раздел 18 ТЗ: быстрый фильтр по статусу прямо в архиве, полноценный
          поиск с датой/суммой/сотрудником/БИН — на экране "Поиск" (раздел 17) */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              status === f.value
                ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]'
                : 'border-[var(--color-line)] bg-[var(--color-paper-raised)] text-[var(--color-ink-soft)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && page === 0 && <p className="mt-6 text-sm text-[var(--color-ink-soft)]">Загрузка…</p>}
      {error && <p className="mt-6 text-sm text-[var(--color-danger)]">{error}</p>}

      {!loading && !error && docs.length === 0 && (
        <div className="viewfinder-corners mt-6 rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper-raised)] p-6 text-[var(--color-accent)]">
          <p className="text-sm text-[var(--color-ink-soft)]">
            {status === 'all'
              ? 'Пока нет ни одной накладной. Нажмите «Сканировать накладную» на главной.'
              : 'Нет накладных с этим статусом.'}
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {docs.map((doc) => (
          <li key={doc.id}>
            <Link
              to={`/documents/${doc.id}`}
              className="block rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-display text-base text-[var(--color-ink)]">
                  {doc.supplier_name || 'Поставщик не распознан'}
                </p>
                <span className="rounded-full bg-[var(--color-stamp-soft)] px-2.5 py-0.5 text-xs text-[var(--color-stamp)]">
                  {STATUS_LABELS[doc.status]}
                </span>
              </div>
              <p className="font-mono-data mt-1 text-xs text-[var(--color-ink-soft)]">
                {doc.invoice_number || '—'} · {doc.invoice_date || '—'} ·{' '}
                {doc.total_amount ? `${doc.total_amount.toLocaleString('ru-RU')} ₸` : '—'}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-ink-soft)]">
                <span>{doc.page_count} стр.</span>
                <span>Кач-во: {doc.quality_score != null ? `${doc.quality_score}%` : '—'}</span>
                {doc.has_qr && <span>QR ✓</span>}
                {doc.has_barcode && <span>Штрихкод ✓</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {hasMore && !loading && (
        <button
          type="button"
          onClick={loadMore}
          className="mt-4 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-sm font-medium text-[var(--color-ink)]"
        >
          Показать ещё
        </button>
      )}
      {loading && page > 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-ink-soft)]">Загрузка…</p>
      )}
    </div>
  )
}
