// Карточка накладной — раздел 15 ТЗ, Часть 3.
//
// OCR (раздел 13, Часть 5) подключён через src/lib/ocr — при первом
// сохранении накладной (Scan.tsx → uploadDocument.ts) поля заполняются
// автоматически. Кнопка «Распознать текст (OCR)» ниже даёт то же самое
// для уже загруженных ранее документов (снятых до Части 5, либо если
// движок не смог отработать при сохранении — см. document_events).
// Форма остаётся полностью редактируемой в любом случае — раздел 13
// прямо требует возможность ручной коррекции распознанных данных.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getSignedUrl } from '../lib/storage'
import { reprocessPage, finalizeReprocessedDocument, DEFAULT_REPROCESS_OPTIONS, type ReprocessOptions, type ReprocessPageResult } from '../lib/reprocess'
import type { ProcessingMode } from '../lib/imageProcessing'
import { runDocumentOcr } from '../lib/ocr'
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

// Баг-фикс: раздел 15 ТЗ требует показывать «сотрудника» в карточке
// документа — раньше поле нигде не читалось и не отображалось.
interface DocWithEmployee extends InvoiceDocument {
  profiles?: { full_name: string | null } | null
}

const STATUS_OPTIONS: DocumentStatus[] = ['new', 'reviewed', 'sent_to_accounting', 'processed', 'archived']

function emptyItem(): RecognizedItem {
  return { name: '', quantity: undefined, unit: '', price: undefined, amount: undefined }
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [doc, setDoc] = useState<DocWithEmployee | null>(null)
  const [reprocessOptions, setReprocessOptions] = useState<ReprocessOptions>(DEFAULT_REPROCESS_OPTIONS)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessError, setReprocessError] = useState<string | null>(null)
  const [reprocessDone, setReprocessDone] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrNotice, setOcrNotice] = useState<string | null>(null)
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
    invoice_number: '',
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
      .select('*, profiles(full_name)')
      .eq('id', id)
      .single()

    if (docError || !docData) {
      setError(docError?.message ?? 'Документ не найден')
      setLoading(false)
      return
    }

    const document = docData as DocWithEmployee
    setDoc(document)
    setForm({
      supplier_name: document.supplier_name ?? '',
      supplier_bin: document.supplier_bin ?? '',
      invoice_number: document.invoice_number ?? '',
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
        invoice_number: form.invoice_number || null,
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
        user_id: session?.user?.id ?? null,
        event_type: 'status_change',
        meta: { status },
      })
      load()
    },
    [id, session, load]
  )

  const handleReprocess = useCallback(async () => {
    if (!id || !session?.user?.id || pages.length === 0) return
    setReprocessing(true)
    setReprocessError(null)
    setReprocessDone(false)
    try {
      const results: ReprocessPageResult[] = []
      for (const page of pages) {
        const r = await reprocessPage(id, session.user.id, page, reprocessOptions)
        results.push(r)
      }
      // Баг-фикс: раньше здесь заканчивалось — коды/качество/PDF
      // оставались от самой первой обработки при сохранении (раздел 8,
      // 20 ТЗ). Теперь пересобираем их одним разом по всем страницам.
      await finalizeReprocessedDocument(id, session.user.id, results)
      setReprocessDone(true)
      window.setTimeout(() => setReprocessDone(false), 2500)
      await load()
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Не удалось улучшить документ')
    } finally {
      setReprocessing(false)
    }
  }, [id, session, pages, reprocessOptions, load])

  // Раздел 13 ТЗ, Часть 5 — повторный/ручной запуск OCR для уже
  // загруженной накладной. Берём УЖЕ ОБРАБОТАННЫЕ страницы (те же файлы,
  // что показаны как «Улучшенный» ниже) по подписанным ссылкам — оригинал
  // в OCR не участвует, соответствует тому же правилу, что и при
  // автоматическом OCR на сохранении.
  //
  // ВНИМАНИЕ: найденные поля подставляются в форму (перезаписывая то, что
  // было — как и любая другая правка формы), но не сохраняются в БД сами
  // по себе — требуют нажатия «Сохранить изменения» ниже, так что
  // случайно потерять уже сохранённые данные нельзя, пока не подтвердишь.
  const handleRunOcr = useCallback(async () => {
    if (!id || pages.length === 0) return
    const pagesToScan = pages.filter((p) => p.processedUrl)
    if (pagesToScan.length === 0) {
      setOcrError('Нет обработанных страниц для распознавания')
      return
    }
    setOcrRunning(true)
    setOcrError(null)
    setOcrNotice(null)
    try {
      const blobs = await Promise.all(
        pagesToScan.map(async (p) => {
          const res = await fetch(p.processedUrl as string)
          if (!res.ok) throw new Error('Не удалось загрузить страницу для распознавания')
          return res.blob()
        })
      )
      const result = await runDocumentOcr(blobs)
      if (result.engineError) {
        setOcrError(`OCR не смог отработать: ${result.engineError}`)
      } else {
        const foundCount = Object.values(result.fields).filter((v) => v !== null && v !== '').length
        setOcrNotice(
          foundCount > 0 || result.items.length > 0
            ? `Распознано полей: ${foundCount}, товаров: ${result.items.length}. Проверьте и сохраните изменения.`
            : 'Не удалось распознать поля на этих страницах — заполните вручную.'
        )
      }
      setForm((f) => ({
        supplier_name: result.fields.supplier_name ?? f.supplier_name,
        supplier_bin: result.fields.supplier_bin ?? f.supplier_bin,
        invoice_number: result.fields.invoice_number ?? f.invoice_number,
        invoice_date: result.fields.invoice_date ?? f.invoice_date,
        total_amount: result.fields.total_amount != null ? String(result.fields.total_amount) : f.total_amount,
        vat_amount: result.fields.vat_amount != null ? String(result.fields.vat_amount) : f.vat_amount,
        bank_details: result.fields.bank_details ?? f.bank_details,
      }))
      if (result.items.length > 0) setItems(result.items)

      await supabase.from('document_events').insert({
        document_id: id,
        user_id: session?.user?.id ?? null,
        event_type: result.engineError ? 'ocr_error' : 'ocr_rerun',
        meta: result.engineError
          ? { message: result.engineError }
          : { fields_found: Object.values(result.fields).filter((v) => v !== null && v !== '').length },
      })
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Не удалось распознать текст')
    } finally {
      setOcrRunning(false)
    }
  }, [id, pages, session])

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
        <span>Сотрудник: {doc.profiles?.full_name || 'неизвестен'}</span>
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
        Поля распознаются автоматически (OCR) при сохранении. Проверьте их и поправьте вручную,
        если что-то распозналось неточно.
      </p>

      <button
        type="button"
        onClick={handleRunOcr}
        disabled={ocrRunning || pages.length === 0}
        className="mt-3 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-2.5 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50"
      >
        {ocrRunning ? 'Распознаём текст…' : 'Распознать текст (OCR) заново'}
      </button>
      {ocrError && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{ocrError}</p>}
      {ocrNotice && !ocrError && <p className="mt-1.5 text-xs text-[var(--color-ok)]">{ocrNotice}</p>}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">Поставщик</span>
          <input
            className="input mt-1"
            value={form.supplier_name}
            onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-ink-soft)]">БИН</span>
          <input
            className="input mt-1 font-mono-data"
            value={form.supplier_bin}
            onChange={(e) => setForm((f) => ({ ...f, supplier_bin: e.target.value }))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Номер накладной</span>
            <input
              className="input mt-1 font-mono-data"
              value={form.invoice_number}
              onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">Дата</span>
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
            <span className="text-xs text-[var(--color-ink-soft)]">Сумма, ₸</span>
            <input
              type="number"
              className="input mt-1 font-mono-data"
              value={form.total_amount}
              onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-soft)]">НДС, ₸</span>
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
            <input
              className="input"
              placeholder="Наименование"
              value={item.name}
              onChange={(e) => updateItem(i, { name: e.target.value })}
            />
            <div className="mt-2 grid grid-cols-4 gap-2">
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
