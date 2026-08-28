// Поиск — раздел 17 ТЗ: по поставщику, БИН, номеру накладной, дате, сумме,
// сотруднику, статусу + фильтр по периоду.
//
// Текстовые/числовые/датные поля (кроме сотрудника) фильтруются прямо в
// SQL-запросе (ilike/gte/lte) — это дёшево и работает по индексам из
// migrations/002_part4.sql. Фильтр по сотруднику фильтруется на клиенте
// после запроса: PostgREST может отдавать связанный profiles(full_name)
// через embed, но фильтрация по вложенному полю через supabase-js менее
// предсказуема на free-text ilike, а результат поиска и так ограничен
// лимитом ниже — для MVP этого достаточно.

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS, type DocumentStatus, type InvoiceDocument } from '../types'

const RESULT_LIMIT = 100

interface SearchResult extends InvoiceDocument {
  profiles?: { full_name: string | null } | null
}

interface FormState {
  supplierName: string
  bin: string
  invoiceNumber: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  employee: string
  status: DocumentStatus | 'all'
}

const EMPTY_FORM: FormState = {
  supplierName: '',
  bin: '',
  invoiceNumber: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  employee: '',
  status: 'all',
}

export default function Search() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const runSearch = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)

    let query = supabase
      .from('documents')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(RESULT_LIMIT)

    if (form.supplierName.trim()) query = query.ilike('supplier_name', `%${form.supplierName.trim()}%`)
    if (form.bin.trim()) query = query.ilike('supplier_bin', `%${form.bin.trim()}%`)
    if (form.invoiceNumber.trim()) query = query.ilike('invoice_number', `%${form.invoiceNumber.trim()}%`)
    if (form.dateFrom) query = query.gte('invoice_date', form.dateFrom)
    if (form.dateTo) query = query.lte('invoice_date', form.dateTo)
    if (form.amountMin) query = query.gte('total_amount', Number(form.amountMin))
    if (form.amountMax) query = query.lte('total_amount', Number(form.amountMax))
    if (form.status !== 'all') query = query.eq('status', form.status)

    const { data, error: queryError } = await query
    if (queryError) {
      setError(queryError.message)
      setResults([])
      setLoading(false)
      return
    }

    let rows = (data as SearchResult[]) ?? []
    if (form.employee.trim()) {
      const needle = form.employee.trim().toLowerCase()
      rows = rows.filter((r) => (r.profiles?.full_name ?? '').toLowerCase().includes(needle))
    }

    setResults(rows)
    setLoading(false)
  }, [form])

  const reset = () => {
    setForm(EMPTY_FORM)
    setResults(null)
    setSearched(false)
    setError(null)
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <h1 className="font-display text-2xl text-[var(--color-ink)]">Поиск</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        По поставщику, БИН, номеру, дате, сумме, сотруднику и статусу.
      </p>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Поставщик</span>
          <input
            className="input mt-1"
            value={form.supplierName}
            onChange={(e) => set('supplierName', e.target.value)}
            placeholder="Название поставщика"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">БИН</span>
            <input
              className="input mt-1 font-mono-data"
              value={form.bin}
              onChange={(e) => set('bin', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Номер накладной</span>
            <input
              className="input mt-1 font-mono-data"
              value={form.invoiceNumber}
              onChange={(e) => set('invoiceNumber', e.target.value)}
            />
          </label>
        </div>

        <div>
          <span className="text-xs text-[var(--color-ink-soft)]">Период (дата накладной)</span>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <input
              type="date"
              className="input"
              value={form.dateFrom}
              onChange={(e) => set('dateFrom', e.target.value)}
            />
            <input
              type="date"
              className="input"
              value={form.dateTo}
              onChange={(e) => set('dateTo', e.target.value)}
            />
          </div>
        </div>

        <div>
          <span className="text-xs text-[var(--color-ink-soft)]">Сумма, ₸</span>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <input
              type="number"
              className="input font-mono-data"
              placeholder="от"
              value={form.amountMin}
              onChange={(e) => set('amountMin', e.target.value)}
            />
            <input
              type="number"
              className="input font-mono-data"
              placeholder="до"
              value={form.amountMax}
              onChange={(e) => set('amountMax', e.target.value)}
            />
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Сотрудник</span>
          <input
            className="input mt-1"
            value={form.employee}
            onChange={(e) => set('employee', e.target.value)}
            placeholder="Кто отсканировал"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Статус</span>
          <select
            className="input mt-1"
            value={form.status}
            onChange={(e) => set('status', e.target.value as FormState['status'])}
          >
            <option value="all">Любой</option>
            {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading}
            className="flex-1 rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)] transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Ищем…' : 'Найти'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-4 py-3 text-sm font-medium text-[var(--color-ink-soft)]"
          >
            Сбросить
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

      {searched && !loading && results && (
        <>
          <p className="mt-6 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
            Найдено: {results.length}
            {results.length === RESULT_LIMIT ? '+' : ''}
          </p>
          {results.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">Ничего не найдено по этим условиям.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {results.map((doc) => (
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
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {doc.profiles?.full_name || 'Сотрудник неизвестен'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
