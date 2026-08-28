// Оркестрация сохранения отснятой накладной — Часть 3 (разделы 5-9, 11,
// 13-15, 19-20 ТЗ, кроме OCR — см. PROGRESS.md, OCR-движок выбирается в
// Части 5).
//
// Точка входа — saveScannedDocument(), вызывается из Scan.tsx (handleSave)
// после экрана проверки. Делает по порядку для каждой страницы:
//   обработка изображения → детект кодов (до/после обработки) → загрузка
//   original + processed в Storage → запись document_pages/document_codes.
// Затем собирает PDF из обработанных страниц, грузит в bucket `pdfs`,
// и обновляет агрегаты в `documents` (page_count, quality_score, has_qr,
// has_barcode, pdf_path, upload_status).
//
// Офлайн-очередь (idb, статусы "Ожидает загрузки"/"Повторить") — Часть 4,
// раздел 23 ТЗ. Здесь — прямая синхронная загрузка "по счастью есть сеть";
// при ошибке документ помечается upload_error и возвращается исключение,
// чтобы экран мог показать понятную ошибку и кнопку повтора.

import { supabase, BUCKETS } from './supabase'
import { processPage } from './imageProcessing'
import { detectCodes, dataUrlToCanvas, type CodeDetection } from './codes'
import { scoreDocumentOverall } from './imageQuality'
import { buildDocumentPdf } from './pdf'
import { getAutoStatusSetting } from './settings'
import { runDocumentOcr } from './ocr'
import type { CapturedPage } from '../components/scan/types'
import type { DocumentStatus } from '../types'

export type SaveStep =
  | 'creating'
  | 'processing'
  | 'uploading'
  | 'codes'
  | 'ocr'
  | 'pdf'
  | 'finalizing'

export interface SaveProgress {
  step: SaveStep
  pageIndex?: number
  pageCount: number
}

export interface SaveResult {
  documentId: string
}

// Баг-фикс (см. PROGRESS.md): раньше повтор после неудачной попытки —
// и в офлайн-очереди (offlineQueue.ts), и в кнопке «Повторить» на экране
// ошибки (Scan.tsx) — вызывал saveScannedDocument() с нуля, а функция
// всегда СОЗДАЁТ новый документ. В итоге первая неудачная попытка
// оставляла висящий документ со статусом upload_error, а вторая, удачная,
// создавала ВТОРОЙ, отдельный документ с теми же страницами — задвоение
// в архиве. Решение: при ошибке saveScannedDocument бросает именно этот
// класс исключения с id уже созданного документа, вызывающая сторона
// сохраняет его и передаёт вторым разом как existingDocumentId — тогда
// функция переиспользует запись вместо создания новой (см. ниже).
export class SaveDocumentError extends Error {
  documentId: string
  constructor(message: string, documentId: string) {
    super(message)
    this.name = 'SaveDocumentError'
    this.documentId = documentId
  }
}

async function uploadBlob(bucket: string, path: string, blob: Blob) {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  })
  if (error) throw new Error(`Не удалось загрузить файл (${bucket}/${path}): ${error.message}`)
}

export async function saveScannedDocument(
  pages: CapturedPage[],
  userId: string,
  onProgress?: (progress: SaveProgress) => void,
  existingDocumentId?: string
): Promise<SaveResult> {
  if (pages.length === 0) throw new Error('Нет страниц для сохранения')

  onProgress?.({ step: 'creating', pageCount: pages.length })

  let documentId: string
  if (existingDocumentId) {
    // Повтор после неудачной попытки — переиспользуем уже созданный
    // документ вместо нового (см. комментарий у SaveDocumentError выше).
    // Строки со страницами/кодами прошлой попытки могли остаться в любом
    // промежуточном состоянии — сносим их и собираем заново с нуля.
    documentId = existingDocumentId
    await supabase.from('document_codes').delete().eq('document_id', documentId)
    await supabase.from('document_pages').delete().eq('document_id', documentId)
    const { error: resetError } = await supabase
      .from('documents')
      .update({ status: 'new', page_count: pages.length, upload_status: 'uploading' })
      .eq('id', documentId)
    if (resetError) throw new Error(resetError.message)
  } else {
    const { data: doc, error: createError } = await supabase
      .from('documents')
      .insert({
        created_by: userId,
        status: 'new',
        page_count: pages.length,
        upload_status: 'uploading',
      })
      .select('id')
      .single()

    if (createError || !doc) {
      throw new Error(createError?.message ?? 'Не удалось создать документ')
    }
    documentId = doc.id as string
  }

  try {
    const pageScores: number[] = []
    let hasQr = false
    let hasBarcode = false
    let hasUnreadableCode = false
    const processedBlobs: Blob[] = []

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      const pageNumber = i + 1
      onProgress?.({ step: 'processing', pageIndex: i, pageCount: pages.length })

      const processed = await processPage(page.dataUrl, page.bounds)
      processedBlobs.push(processed.blob)

      onProgress?.({ step: 'codes', pageIndex: i, pageCount: pages.length })
      const [originalCanvas, processedCanvas] = await Promise.all([
        dataUrlToCanvas(page.dataUrl),
        dataUrlToCanvas(processed.dataUrl),
      ])
      const beforeCodes = detectCodes(originalCanvas)
      const afterCodes = detectCodes(processedCanvas)
      // Раздел 8-9: проверяем читаемость ПОСЛЕ обработки; если код был
      // виден до, но пропал после — считаем нечитаемым и предупреждаем.
      const codesForPage: CodeDetection[] = afterCodes.length > 0 ? afterCodes : beforeCodes
      const readableAfter = afterCodes.length > 0
      if (beforeCodes.length > 0 && !readableAfter) hasUnreadableCode = true
      if (codesForPage.some((c) => c.type === 'qr')) hasQr = true
      if (codesForPage.some((c) => c.type === 'barcode' || c.type === 'datamatrix')) hasBarcode = true

      onProgress?.({ step: 'uploading', pageIndex: i, pageCount: pages.length })
      const originalPath = `${userId}/${documentId}/${pageNumber}-original.jpg`
      const processedPath = `${userId}/${documentId}/${pageNumber}-processed.jpg`
      await uploadBlob(BUCKETS.originals, originalPath, page.blob)
      await uploadBlob(BUCKETS.processed, processedPath, processed.blob)

      const isBlurry = page.warnings.some((w) => w.includes('смазано'))
      const hasGlare = page.warnings.some((w) => w.includes('блик'))

      const { data: pageRow, error: pageError } = await supabase
        .from('document_pages')
        .insert({
          document_id: documentId,
          page_number: pageNumber,
          original_path: originalPath,
          processed_path: processedPath,
          quality_score: page.score,
          is_blurry: isBlurry,
          has_glare: hasGlare,
          qr_readable: codesForPage.some((c) => c.type === 'qr') ? readableAfter : null,
          barcode_readable:
            codesForPage.some((c) => c.type === 'barcode' || c.type === 'datamatrix') ? readableAfter : null,
        })
        .select('id')
        .single()

      if (pageError || !pageRow) {
        throw new Error(pageError?.message ?? 'Не удалось сохранить страницу документа')
      }

      if (codesForPage.length > 0) {
        await supabase.from('document_codes').insert(
          codesForPage.map((c) => ({
            document_id: documentId,
            page_id: pageRow.id as string,
            code_type: c.type,
            raw_value: c.rawValue,
            is_readable: readableAfter,
          }))
        )
      }

      pageScores.push(page.score)
    }

    // Раздел 13 ТЗ (Часть 5) — OCR по ОБРАБОТАННЫМ страницам, сразу после
    // сохранения. Намеренно обёрнуто в try/catch: если движок не смог
    // отработать (модель не загрузилась, WASM недоступен на устройстве и
    // т.п.), это не должно ломать сохранение самой накладной — поля
    // просто останутся пустыми для ручного заполнения, как было до
    // Части 5, плюс запись в document_events для видимости в /admin.
    onProgress?.({ step: 'ocr', pageCount: pages.length })
    let ocrFields: Awaited<ReturnType<typeof runDocumentOcr>>['fields'] | null = null
    let ocrItems: Awaited<ReturnType<typeof runDocumentOcr>>['items'] = []
    try {
      const ocrResult = await runDocumentOcr(processedBlobs)
      ocrFields = ocrResult.fields
      ocrItems = ocrResult.items
      await supabase.from('document_events').insert({
        document_id: documentId,
        user_id: userId,
        event_type: ocrResult.engineError ? 'ocr_error' : 'ocr_completed',
        meta: ocrResult.engineError
          ? { message: ocrResult.engineError }
          : {
              fields_found: Object.values(ocrResult.fields).filter((v) => v !== null && v !== '').length,
              items_found: ocrResult.items.length,
            },
      })
    } catch (err) {
      await supabase.from('document_events').insert({
        document_id: documentId,
        user_id: userId,
        event_type: 'ocr_error',
        meta: { message: err instanceof Error ? err.message : String(err) },
      })
    }

    onProgress?.({ step: 'pdf', pageCount: pages.length })
    const pdfBlob = await buildDocumentPdf(processedBlobs)
    const pdfPath = `${userId}/${documentId}/document.pdf`
    await uploadBlob(BUCKETS.pdfs, pdfPath, pdfBlob)

    onProgress?.({ step: 'finalizing', pageCount: pages.length })
    const quality = scoreDocumentOverall({ pageScores, hasUnreadableCode })

    // Раздел 18 ТЗ: статус может меняться автоматически "в зависимости от
    // настроек системы" — если включено в админ-панели и качество
    // документа достаточное, сразу ставим "Проверен" вместо "Новый".
    let status: DocumentStatus = 'new'
    try {
      const autoStatus = await getAutoStatusSetting()
      if (autoStatus.enabled && quality.score >= autoStatus.quality_threshold) {
        status = 'reviewed'
      }
    } catch {
      // настройка недоступна (например, миграция 002 ещё не выполнена) —
      // остаёмся на статусе по умолчанию, это не должно ломать сохранение
    }

    const { error: updateError } = await supabase
      .from('documents')
      .update({
        page_count: pages.length,
        quality_score: quality.score,
        has_qr: hasQr,
        has_barcode: hasBarcode,
        pdf_path: pdfPath,
        upload_status: 'uploaded',
        status,
        // Раздел 13 ТЗ — автозаполнение результатом OCR, при этом
        // возможность ручной правки сохраняется полностью (карточка
        // документа как была редактируемой, так и осталась — см.
        // DocumentDetail.tsx). Если поле не распозналось — оставляем
        // null, как и раньше (до Части 5 все эти поля тоже были null
        // сразу после сохранения).
        ...(ocrFields
          ? {
              supplier_name: ocrFields.supplier_name,
              supplier_bin: ocrFields.supplier_bin,
              invoice_number: ocrFields.invoice_number,
              invoice_date: ocrFields.invoice_date,
              total_amount: ocrFields.total_amount,
              vat_amount: ocrFields.vat_amount,
              bank_details: ocrFields.bank_details ? { raw: ocrFields.bank_details } : null,
            }
          : {}),
        ...(ocrItems.length > 0 ? { recognized_items: ocrItems } : {}),
      })
      .eq('id', documentId)

    if (updateError) throw new Error(updateError.message)

    await supabase.from('document_events').insert({
      document_id: documentId,
      user_id: userId,
      event_type: 'uploaded',
      meta: { page_count: pages.length, quality_score: quality.score },
    })
    if (status === 'reviewed') {
      await supabase.from('document_events').insert({
        document_id: documentId,
        user_id: userId,
        event_type: 'status_change',
        meta: { status, auto: true },
      })
    }

    return { documentId }
  } catch (err) {
    await supabase.from('documents').update({ upload_status: 'upload_error' }).eq('id', documentId)
    await supabase.from('document_events').insert({
      document_id: documentId,
      user_id: userId,
      event_type: 'processing_error',
      meta: { message: err instanceof Error ? err.message : String(err) },
    })
    // documentId сохраняется в исключении, чтобы повтор (Scan.tsx /
    // offlineQueue.ts) переиспользовал этот же документ — см.
    // SaveDocumentError выше.
    throw new SaveDocumentError(err instanceof Error ? err.message : String(err), documentId)
  }
}
