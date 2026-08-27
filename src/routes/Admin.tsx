// Панель администратора — раздел 25 ТЗ. Доступна только роли `admin`
// (проверка ниже; RLS на бэкенде тоже это гарантирует — documents_delete,
// profiles_update_by_admin и т.д. из migrations/002_part4.sql).

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getSignedUrl } from '../lib/storage'
import { loadAnalytics, type AnalyticsSummary } from '../lib/analytics'
import { getAutoStatusSetting, setAutoStatusSetting, type AutoStatusSetting } from '../lib/settings'
import { STATUS_LABELS, type DocumentStatus, type InvoiceDocument, type Profile, type UserRole } from '../types'

const DOC_LIMIT = 30
const ROLE_LABELS: Record<UserRole, string> = { employee: 'Сотрудник', accountant: 'Бухгалтер', admin: 'Администратор' }

interface ProcessingError {
  id: string
  document_id: string | null
  created_at: string
  meta: { message?: string } | null
}

export default function Admin() {
  const { profile } = useAuth()

  if (profile && profile.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md px-5 pb-28 pt-8">
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Панель администратора</h1>
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          Доступ только для роли «Администратор». Обратитесь к администратору системы, если это ошибка.
        </p>
      </div>
    )
  }

  return <AdminPanel />
}

function AdminPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null)
  const [docs, setDocs] = useState<InvoiceDocument[]>([])
  const [docFilter, setDocFilter] = useState('')
  const [docsLoading, setDocsLoading] = useState(true)
  const [users, setUsers] = useState<Profile[]>([])
  const [errors, setErrors] = useState<ProcessingError[]>([])
  const [autoStatus, setAutoStatus] = useState<AutoStatusSetting | null>(null)
  const [savingSetting, setSavingSetting] = useState(false)

  const loadDocs = useCallback(async (filter: string) => {
    setDocsLoading(true)
    let query = supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(DOC_LIMIT)
    if (filter.trim()) {
      const needle = filter.trim()
      query = query.or(`supplier_name.ilike.%${needle}%,invoice_number.ilike.%${needle}%,supplier_bin.ilike.%${needle}%`)
    }
    const { data } = await query
    setDocs((data as InvoiceDocument[]) ?? [])
    setDocsLoading(false)
  }, [])

  useEffect(() => {
    loadAnalytics().then(setAnalytics)
    loadDocs('')
    supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setUsers((data as Profile[]) ?? []))
    supabase
      .from('document_events')
      .select('id, document_id, created_at, meta')
      .eq('event_type', 'processing_error')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setErrors((data as ProcessingError[]) ?? []))
    getAutoStatusSetting().then(setAutoStatus)
  }, [loadDocs])

  const handleDocSearch = () => loadDocs(docFilter)

  const handleStatusChange = async (docId: string, status: DocumentStatus) => {
    await supabase.from('documents').update({ status }).eq('id', docId)
    await supabase.from('document_events').insert({ document_id: docId, event_type: 'status_change', meta: { status, by: 'admin' } })
    loadDocs(docFilter)
  }

  const handleDelete = async (docId: string) => {
    if (!window.confirm('Удалить накладную безвозвратно? Файлы в Storage останутся (можно удалить вручную из Supabase), но запись и все связанные данные будут удалены.')) return
    await supabase.from('documents').delete().eq('id', docId)
    loadDocs(docFilter)
    loadAnalytics().then(setAnalytics)
  }

  const handleDownload = async (docId: string) => {
    const doc = docs.find((d) => d.id === docId)
    if (!doc?.pdf_path) return
    const url = await getSignedUrl('pdfs', doc.pdf_path)
    if (url) window.open(url, '_blank')
  }

  const handleRoleChange = async (userId: string, role: UserRole) => {
    await supabase.from('profiles').update({ role }).eq('id', userId)
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
  }

  const handleAutoStatusSave = async () => {
    if (!autoStatus) return
    setSavingSetting(true)
    await setAutoStatusSetting(autoStatus)
    setSavingSetting(false)
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <h1 className="font-display text-2xl text-[var(--color-ink)]">Панель администратора</h1>

      {/* Раздел 26 ТЗ: аналитика */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Аналитика</h2>
      {!analytics ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">Загрузка…</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Всего накладных" value={analytics.totalDocuments} />
          <Stat label="За сегодня" value={analytics.documentsToday} />
          <Stat label="За месяц" value={analytics.documentsThisMonth} />
          <Stat label="Передано бухгалтерии" value={analytics.sentToAccounting} />
          <Stat label="Некачественных сканов" value={analytics.lowQualityScans} danger />
          <Stat label="Пересъёмок" value={analytics.retakes} />
        </div>
      )}
      {analytics && analytics.bySupplier.length > 0 && (
        <div className="mt-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
          <p className="text-xs font-medium text-[var(--color-ink-soft)]">По поставщикам</p>
          <ul className="mt-1.5 space-y-1">
            {analytics.bySupplier.map((s) => (
              <li key={s.supplier} className="flex justify-between text-xs text-[var(--color-ink)]">
                <span className="truncate pr-2">{s.supplier}</span>
                <span className="font-mono-data shrink-0">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Раздел 18 ТЗ: настройка автоматической смены статуса */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Автоматический статус</h2>
      {autoStatus && (
        <div className="mt-2 space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={autoStatus.enabled}
              onChange={(e) => setAutoStatus((s) => (s ? { ...s, enabled: e.target.checked } : s))}
            />
            Переводить в «Проверен» автоматически при хорошем качестве
          </label>
          <label className="block text-xs text-[var(--color-ink-soft)]">
            Порог качества, %
            <input
              type="number"
              min={0}
              max={100}
              className="input mt-1 font-mono-data"
              value={autoStatus.quality_threshold}
              onChange={(e) =>
                setAutoStatus((s) => (s ? { ...s, quality_threshold: Number(e.target.value) } : s))
              }
            />
          </label>
          <button
            type="button"
            onClick={handleAutoStatusSave}
            disabled={savingSetting}
            className="w-full rounded-xl bg-[var(--color-ink)] py-2 text-sm font-semibold text-[var(--color-paper)] disabled:opacity-50"
          >
            {savingSetting ? 'Сохраняем…' : 'Сохранить настройку'}
          </button>
        </div>
      )}

      {/* Раздел 25 ТЗ: документы — поиск, статус, удаление, скачивание */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Документы</h2>
      <div className="mt-2 flex gap-2">
        <input
          className="input"
          placeholder="Поставщик, номер, БИН…"
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleDocSearch()}
        />
        <button
          type="button"
          onClick={handleDocSearch}
          className="shrink-0 rounded-xl bg-[var(--color-ink)] px-4 text-sm font-medium text-[var(--color-paper)]"
        >
          Найти
        </button>
      </div>

      {docsLoading ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">Загрузка…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {docs.map((doc) => (
            <li key={doc.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link to={`/documents/${doc.id}`} className="font-display truncate text-sm text-[var(--color-ink)]">
                    {doc.supplier_name || 'Без поставщика'}
                  </Link>
                  <p className="font-mono-data text-xs text-[var(--color-ink-soft)]">
                    {doc.invoice_number || '—'} · Кач-во {doc.quality_score ?? '—'}%
                    {doc.upload_status === 'upload_error' && (
                      <span className="text-[var(--color-danger)]"> · ошибка</span>
                    )}
                  </p>
                </div>
                <select
                  value={doc.status}
                  onChange={(e) => handleStatusChange(doc.id, e.target.value as DocumentStatus)}
                  className="shrink-0 rounded-full bg-[var(--color-stamp-soft)] px-2 py-1 text-xs text-[var(--color-stamp)]"
                >
                  {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex gap-3">
                {doc.pdf_path && (
                  <button type="button" onClick={() => handleDownload(doc.id)} className="text-xs font-medium text-[var(--color-accent)]">
                    Скачать PDF
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(doc.id)} className="text-xs font-medium text-[var(--color-danger)]">
                  Удалить
                </button>
              </div>
            </li>
          ))}
          {docs.length === 0 && <p className="text-sm text-[var(--color-ink-soft)]">Ничего не найдено.</p>}
        </ul>
      )}

      {/* Раздел 25 ТЗ: ошибки обработки */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Ошибки обработки</h2>
      {errors.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">Ошибок не зафиксировано.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {errors.map((e) => (
            <li key={e.id} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-3 py-2 text-xs">
              <div className="flex items-center justify-between text-[var(--color-ink-soft)]">
                <span>{new Date(e.created_at).toLocaleString('ru-RU')}</span>
                {e.document_id && (
                  <Link to={`/documents/${e.document_id}`} className="text-[var(--color-accent)]">
                    Документ
                  </Link>
                )}
              </div>
              <p className="mt-0.5 text-[var(--color-danger)]">{e.meta?.message ?? 'Без описания'}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Раздел 25 ТЗ: пользователи и доступ */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Пользователи и доступ</h2>
      <ul className="mt-2 space-y-1.5">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-3 py-2">
            <span className="truncate text-sm text-[var(--color-ink)]">{u.full_name || u.id.slice(0, 8)}</span>
            <select
              value={u.role}
              onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
              className="shrink-0 rounded-full bg-[var(--color-stamp-soft)] px-2 py-1 text-xs text-[var(--color-stamp)]"
            >
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
      <p className={`font-mono-data text-xl ${danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'}`}>{value}</p>
      <p className="text-xs text-[var(--color-ink-soft)]">{label}</p>
    </div>
  )
}
