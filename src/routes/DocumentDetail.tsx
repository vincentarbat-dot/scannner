// Карточка накладной — раздел 15 ТЗ, Часть 3.
//
// Часть 5: OCR заполняет эту же форму; ручное исправление пользователя является источником истины.


import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getSignedUrl } from '../lib/storage'
import { reprocessPage, DEFAULT_REPROCESS_OPTIONS, type ReprocessOptions } from '../lib/reprocess'
import type { ProcessingMode } from '../lib/imageProcessing'
import {
  STATUS_LABELS,
  CODE_TYPE_LABELS,
  type InvoiceDocument,
  type DocumentPage,
  type DocumentCode,
  type DocumentStatus,
  type RecognizedItem,
} from '../types'

interface PageWithUrls extends DocumentPage {
  originalUrl: string | null
  processedUrl: string | null
}

const STATUS_OPTIONS: DocumentStatus[] = ['new', 'reviewed', 'sent_to_accounting', 'processed', 'archived']

function OcrConfidence({ doc, field }: { doc: InvoiceDocument; field: string }) {
  const parsed = doc.ocr_result && typeof doc.ocr_result === 'object' ? (doc.ocr_result as { parsed?: Record<string, { confidence?: number; needsReview?: boolean }> }).parsed : undefined
  const confidence = parsed?.[field]?.confidence
  if (confidence == null) return null
  const low = parsed?.[field]?.needsReview || confidence < 0.75
  return <span className={low ? 'ml-2 text-xs text-[var(--color-danger)]' : 'ml-2 text-xs text-[var(--color-ok)]'}>{low ? '⚠ проверить OCR' : `OCR ${Math.round(confidence * 100)}%`}</span>
}

function emptyItem(): RecognizedItem {
  return { name: '', quantity: undefined, unit: '', price: undefined, amount: undefined }
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [doc, setDoc] = useState<InvoiceDocument | null>(null)
  const [reprocessOptions, setReprocessOptions] = useState<ReprocessOptions>(DEFAULT_REPROCESS_OPTIONS)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessError, setReprocessError] = useState<string | null>(null)
  const [reprocessDone, setReprocessDone] = useState(false)
  const [pages, setPages] = useState<PageWithUrls[]>([])
  const [codes, setCodes] = useState<DocumentCode[]>([])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Форма — редактируемая копия распознаваемых полей (раздел 13, 15 ТЗ)
  const [form, setForm] = useState({
    supplier_name: '',
    supplier_bin: '',
    supplier_iin: '',
    invoice_number: '',
    document_number: '',
    invoice_date: '',
    total_amount: '',
    vat_amount: '',
    bank_details: '',
  })
  const [items, setItems] = useState<RecognizedItem[]>([])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const { data: docData, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single()

    if (docError || !docData) {
      setError(docError?.message ?? 'Документ не найден')
      setLoading(false)
      return
    }

    const document = docData as InvoiceDocument
    setDoc(document)
    setForm({
      supplier_name: document.supplier_name ?? '',
      supplier_bin: document.supplier_bin ?? '',
      supplier_iin: document.supplier_iin ?? '',
      invoice_number: document.invoice_number ?? '',
      document_number: document.document_number ?? '',
      invoice_date: document.invoice_date ?? '',
      total_amount: document.total_amount != null ? String(document.total_amount) : '',
      vat_amount: document.vat_amount != null ? String(document.vat_amount) : '',
      bank_details:
        document.bank_details && typeof document.bank_details.raw === 'string'
          ? (document.bank_details.raw as string)
          : '',
    })
    setItems(document.recognized_items && document.recognized_items.length > 0 ? document.recognized_items : [])

    const { data: pagesData } = await supabase
      .from('document_pages')
      .select('*')
      .eq('document_id', id)
      .order('page_number', { ascending: true })

    const pagesWithUrls: PageWithUrls[] = await Promise.all(
      ((pagesData as DocumentPage[]) ?? []).map(async (p) => ({
        ...p,
        originalUrl: await getSignedUrl('originals', p.original_path),
        processedUrl: p.processed_path ? await getSignedUrl('processed', p.processed_path) : null,
      }))
    )
    setPages(pagesWithUrls)

    const { data: codesData } = await supabase.from('document_codes').select('*').eq('document_id', id)
    setCodes((codesData as DocumentCode[]) ?? [])

    if (document.pdf_path) {
      setPdfUrl(await getSignedUrl('pdfs', document.pdf_path))
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!id) return
    setSaving(true)
    setSaved(false)
    const cleanedItems = items.filter((it) => it.name.trim().length > 0)
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        supplier_name: form.supplier_name || null,
        supplier_bin: form.supplier_bin || null,
        supplier_iin: form.supplier_iin || null,
        invoice_number: form.invoice_number || null,
        document_number: form.document_number || null,
        invoice_date: form.invoice_date || null,
        total_amount: form.total_amount ? Number(form.total_amount) : null,
        vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        bank_details: form.bank_details ? { raw: form.bank_details } : null,
        recognized_items: cleanedItems.length > 0 ? cleanedItems : null,
      })
      .eq('id', id)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
    load()
  }, [id, form, items, load])

  const handleStatusChange = useCallback(
    async (status: DocumentStatus) => {
      if (!id) return
      await supabase.from('documents').update({ status }).eq('id', id)
      await supabase.from('document_events').insert({
        document_id: id,
        event_type: 'status_change',
        meta: { status },
      })
      load()
    },
    [id, load]
  )

  const handleReprocess = useCallback(async () => {
    if (!id || !session?.user?.id || pages.length === 0) return
    setReprocessing(true)
    setReprocessError(null)
    setReprocessDone(false)
    try {
      for (const page of pages) {
        await reprocessPage(id, session.user.id, page, reprocessOptions)
      }
      setReprocessDone(true)
      window.setTimeout(() => setReprocessDone(false), 2500)
      await load()
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Не удалось улучшить документ')
    } finally {
      setReprocessing(false)
    }
  }, [id, session, pages, reprocessOptions, load])

  const updateItem = (index: number, patch: Partial<RecognizedItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-5 pb-28 pt-8">
        <p className="text-sm text-[var(--color-ink-soft)]">Загрузка…</p>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="mx-auto max-w-md px-5 pb-28 pt-8">
        <p className="text-sm text-[var(--color-danger)]">{error ?? 'Документ не найден'}</p>
        <button
          type="button"
          onClick={() => navigate('/archive')}
          className="mt-4 text-sm font-medium text-[var(--color-accent)]"
        >
          ← Назад в архив
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <Link to="/archive" className="text-sm font-medium text-[var(--color-ink-soft)]">
        ← Архив
      </Link>

      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl text-[var(--color-ink)]">
          {doc.supplier_name || 'Накладная без названия'}
        </h1>
        <select
          value={doc.status}
          onChange={(e) => handleStatusChange(e.target.value as DocumentStatus)}
          className="shrink-0 rounded-full bg-[var(--color-stamp-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-stamp)]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-ink-soft)]">
        <span>Страниц: {doc.page_count}</span>
        <span>
          Качество: {doc.quality_score != null ? `${doc.quality_score}%` : '—'}
        </span>
        <span>Загружено: {new Date(doc.created_at).toLocaleString('ru-RU')}</span>
        {doc.upload_status === 'upload_error' && (
          <span className="text-[var(--color-danger)]">Ошибка загрузки</span>
        )}
      </div>

      {/* Раздел 8-9, 14 ТЗ: обнаруженные коды */}
      <div className="mt-4">
        {codes.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-soft)]">QR-коды/штрихкоды не обнаружены на этой накладной.</p>
        ) : (
          <ul className="space-y-1.5">
            {codes.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-3 py-2 text-xs"
              >
                <span className="font-medium text-[var(--color-ink)]">
                  {CODE_TYPE_LABELS[c.code_type]}
                </span>
                <span className="font-mono-data truncate px-2 text-[var(--color-ink-soft)]">{c.raw_value}</span>
                <span className={c.is_readable ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}>
                  {c.is_readable ? '✓ читается' : '⚠ плохо читается'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Раздел 20 ТЗ: два варианта каждой страницы */}
      {doc.ocr_result && (
        <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
          <p className="text-sm font-medium text-[var(--color-ink)]">OCR: PaddleOCR.js · PP-OCRv5</p>
          <p className="mt-1 text-xs text-[var(--color-ink-soft)]">Результат сохранён для проверки. Значения с низкой уверенностью отмечены ⚠.</p>
        </div>
      )}

      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Страницы</h2>
      <div className="mt-2 space-y-3">
        {pages.map((p) => (
          <div key={p.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
            <p className="text-xs font-medium text-[var(--color-ink-soft)]">Страница {p.page_number}</p>
            <div className="mt-2 flex gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-ink-soft)]">Оригинал</p>
                {p.originalUrl ? (
                  <a href={p.originalUrl} target="_blank" rel="noreferrer">
                    <img
                      src={p.originalUrl}
                      alt={`Оригинал страницы ${p.page_number}`}
                      className="mt-1 h-28 w-20 rounded-lg border border-[var(--color-line)] object-cover"
                    />
                  </a>
                ) : (
                  <div className="mt-1 h-28 w-20 rounded-lg bg-[var(--color-line)]" />
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-ink-soft)]">Улучшенный</p>
                {p.processedUrl ? (
                  <a href={p.processedUrl} target="_blank" rel="noreferrer">
                    <img
                      src={p.processedUrl}
                      alt={`Обработанная страница ${p.page_number}`}
                      className="mt-1 h-28 w-20 rounded-lg border border-[var(--color-line)] object-cover"
                    />
                  </a>
                ) : (
                  <div className="mt-1 h-28 w-20 rounded-lg bg-[var(--color-line)]" />
                )}
              </div>
              <div className="flex flex-col justify-center gap-1 text-xs text-[var(--color-ink-soft)]">
                <span>Кач-во: {p.quality_score ?? '—'}%</span>
                {p.is_blurry && <span className="text-[var(--color-danger)]">Размыто</span>}
                {p.has_glare && <span className="text-[var(--color-danger)]">Блик</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Раздел 21 ТЗ: повторная обработка уже загруженной накладной.
          Оригиналы не трогаются — перезаписывается только "улучшенная"
          версия каждой страницы, применяется ко всем страницам сразу. */}
      <details className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-accent)]">
          Улучшить документ
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs text-[var(--color-ink-soft)]">Цветовой режим</span>
            <div className="mt-1 flex gap-2">
              {(
                [
                  { value: 'color', label: 'Цветной' },
                  { value: 'grayscale', label: 'Градации серого' },
                  { value: 'bw', label: 'Ч/Б' },
                ] as Array<{ value: ProcessingMode; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReprocessOptions((o) => ({ ...o, mode: opt.value }))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    reprocessOptions.mode === opt.value
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]'
                      : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {(
              [
                { key: 'flattenShadows', label: 'Убрать тени' },
                { key: 'autoContrastEnabled', label: 'Улучшить контраст' },
                { key: 'sharpen', label: 'Повысить резкость' },
                { key: 'denoise', label: 'Улучшить качество (шумоподавление)' },
              ] as Array<{ key: keyof ReprocessOptions; label: string }>
            ).map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                <input
                  type="checkbox"
                  checked={Boolean(reprocessOptions[opt.key])}
                  onChange={(e) =>
                    setReprocessOptions((o) => ({ ...o, [opt.key]: e.target.checked }))
                  }
                />
                {opt.label}
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleReprocess}
            disabled={reprocessing}
            className="w-full rounded-xl bg-[var(--color-ink)] py-2.5 text-sm font-semibold text-[var(--color-paper)] disabled:opacity-50"
          >
            {reprocessing ? 'Обрабатываем…' : reprocessDone ? 'Готово ✓' : 'Применить ко всем страницам'}
          </button>
          {reprocessError && <p className="text-xs text-[var(--color-danger)]">{reprocessError}</p>}
          <p className="text-xs text-[var(--color-ink-soft)]">
            Оригиналы страниц не изменяются — обновляется только «Улучшенная» версия.
          </p>
        </div>
      </details>

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-center text-sm font-medium text-[var(--color-accent)]"
        >
          Скачать PDF
        </a>
      )}

      {/* Раздел 13, 15 ТЗ: распознанные / вводимые вручную поля */}
      <h2 className="font-display mt-6 text-lg text-[var(--color-ink)]">Данные накладной</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
        PaddleOCR автоматически заполняет поля. Проверьте значения с ⚠ перед сохранением — ручная правка пользователя имеет приоритет.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Поставщик<OcrConfidence doc={doc} field="supplier_name" /></span>
          <input
            className="input mt-1"
            value={form.supplier_name}
            onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">БИН<OcrConfidence doc={doc} field="supplier_bin" /></span>
          <input
            className="input mt-1 font-mono-data"
            value={form.supplier_bin}
            onChange={(e) => setForm((f) => ({ ...f, supplier_bin: e.target.value }))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">ИИН<OcrConfidence doc={doc} field="supplier_iin" /></span>
          <input
            className="input mt-1 font-mono-data"
            value={form.supplier_iin}
            onChange={(e) => setForm((f) => ({ ...f, supplier_iin: e.target.value }))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Номер накладной<OcrConfidence doc={doc} field="invoice_number" /></span>
            <input
              className="input mt-1 font-mono-data"
              value={form.invoice_number}
              onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Номер документа<OcrConfidence doc={doc} field="document_number" /></span>
            <input
              className="input mt-1 font-mono-data"
              value={form.document_number}
              onChange={(e) => setForm((f) => ({ ...f, document_number: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Дата<OcrConfidence doc={doc} field="invoice_date" /></span>
            <input
              type="date"
              className="input mt-1"
              value={form.invoice_date}
              onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Сумма, ₸<OcrConfidence doc={doc} field="total_amount" /></span>
            <input
              type="number"
              className="input mt-1 font-mono-data"
              value={form.total_amount}
              onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">НДС, ₸<OcrConfidence doc={doc} field="vat_amount" /></span>
            <input
              type="number"
              className="input mt-1 font-mono-data"
              value={form.vat_amount}
              onChange={(e) => setForm((f) => ({ ...f, vat_amount: e.target.value }))}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Банковские реквизиты</span>
          <textarea
            className="input mt-1 min-h-20"
            value={form.bank_details}
            onChange={(e) => setForm((f) => ({ ...f, bank_details: e.target.value }))}
            placeholder="БИК, ИИК, банк-получатель…"
          />
        </label>
      </div>

      <h3 className="font-display mt-5 text-base text-[var(--color-ink)]">Товары</h3>
      <div className="mt-2 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3">
            {item.confidence != null && (
              <p className={item.needsReview ? 'mb-1 text-xs text-[var(--color-danger)]' : 'mb-1 text-xs text-[var(--color-ok)]'}>
                {item.needsReview ? '⚠ Низкая уверенность OCR — проверьте строку' : `OCR: ${Math.round(item.confidence * 100)}%`}
              </p>
            )}
            <input
              className="input"
              placeholder="Наименование"
              value={item.name}
              onChange={(e) => updateItem(i, { name: e.target.value })}
            />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <input
                className="input"
                placeholder="Артикул"
                value={item.article ?? ''}
                onChange={(e) => updateItem(i, { article: e.target.value })}
              />
              <input
                type="number"
                className="input font-mono-data"
                placeholder="Кол-во"
                value={item.quantity ?? ''}
                onChange={(e) => updateItem(i, { quantity: e.target.value ? Number(e.target.value) : undefined })}
              />
              <input
                className="input"
                placeholder="Ед."
                value={item.unit ?? ''}
                onChange={(e) => updateItem(i, { unit: e.target.value })}
              />
              <input
                type="number"
                className="input font-mono-data"
                placeholder="Цена"
                value={item.price ?? ''}
                onChange={(e) => updateItem(i, { price: e.target.value ? Number(e.target.value) : undefined })}
              />
              <input
                type="number"
                className="input font-mono-data"
                placeholder="Сумма"
                value={item.amount ?? ''}
                onChange={(e) => updateItem(i, { amount: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              className="mt-2 text-xs font-medium text-[var(--color-danger)]"
            >
              Удалить строку
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, emptyItem()])}
          className="w-full rounded-xl border border-dashed border-[var(--color-line)] py-2.5 text-sm font-medium text-[var(--color-accent)]"
        >
          + Добавить товар
        </button>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-6 w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)] transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {saving ? 'Сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить изменения'}
      </button>
    </div>
  )
}
