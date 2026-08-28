// «Улучшить документ» — раздел 21 ТЗ. Берёт уже загруженный ОРИГИНАЛ
// страницы (не трогая его — раздел 21: "оригинал при этом не изменяется"),
// прогоняет через processPage() с выбранными пользователем опциями и
// перезаписывает `processed`-файл в Storage (upsert). bounds на этом этапе
// уже не храним (страница давно снята), поэтому обрезка по границам
// документа не повторяется — только цветокоррекция/резкость/тени/контраст,
// что и просит раздел 21 (сам контур обрезки не входит в список опций там).
//
// Баг-фикс (см. PROGRESS.md): раньше reprocessPage() только перезаписывал
// картинку и ничего больше — is_blurry/has_glare/qr_readable/has_qr на
// странице и документе оставались от самой первой обработки при
// сохранении, а PDF вообще не пересобирался. Раздел 8 ТЗ прямо требует
// проверять читаемость QR/штрихкода ПОСЛЕ обработки — включая повторную,
// а раздел 20 называет PDF "Улучшенным документом", то есть он должен
// отражать актуальную обработку. Теперь: reprocessPage() пересчитывает
// коды/резкость/блики по каждой странице, а finalizeReprocessedDocument()
// (вызывается один раз после цикла по всем страницам — см. DocumentDetail.tsx)
// пересобирает document_codes/has_qr/has_barcode и сам PDF.

import { supabase, BUCKETS } from './supabase'
import { processPage, type ProcessingMode } from './imageProcessing'
import { getSignedUrl } from './storage'
import { detectCodes, dataUrlToCanvas, type CodeDetection } from './codes'
import { assessProcessedImage } from './imageQuality'
import { buildDocumentPdf } from './pdf'

export interface ReprocessOptions {
  mode: ProcessingMode
  denoise: boolean
  flattenShadows: boolean
  autoContrastEnabled: boolean
  sharpen: boolean
}

export const DEFAULT_REPROCESS_OPTIONS: ReprocessOptions = {
  mode: 'color',
  denoise: true,
  flattenShadows: true,
  autoContrastEnabled: true,
  sharpen: true,
}

async function loadAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Не удалось загрузить оригинал страницы')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface ReprocessPageResult {
  pageId: string
  processedPath: string
  blob: Blob
  codes: CodeDetection[]
}

export async function reprocessPage(
  documentId: string,
  userId: string,
  page: { id: string; original_path: string; processed_path: string | null },
  options: ReprocessOptions
): Promise<ReprocessPageResult> {
  const signedUrl = await getSignedUrl(BUCKETS.originals, page.original_path)
  if (!signedUrl) throw new Error('Не удалось получить ссылку на оригинал')

  const sourceDataUrl = await loadAsDataUrl(signedUrl)

  const result = await processPage(sourceDataUrl, null, {
    mode: options.mode,
    skipCrop: true,
    denoise: options.denoise,
    flattenShadows: options.flattenShadows,
    autoContrastEnabled: options.autoContrastEnabled,
    sharpen: options.sharpen,
  })

  const processedPath = page.processed_path ?? page.original_path.replace('-original.jpg', '-processed.jpg')

  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.processed)
    .upload(processedPath, result.blob, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw new Error(`Не удалось сохранить улучшенную версию: ${uploadError.message}`)

  // Раздел 8 ТЗ: читаемость кода нужно проверять именно ПОСЛЕ обработки —
  // включая повторную. Плюс пересчитываем резкость/блики по новой версии.
  const processedCanvas = await dataUrlToCanvas(result.dataUrl)
  const codes = detectCodes(processedCanvas)
  const ctx = processedCanvas.getContext('2d')
  const imageData = ctx?.getImageData(0, 0, processedCanvas.width, processedCanvas.height)
  const assessment = imageData ? assessProcessedImage(imageData) : { isBlurry: false, hasGlare: false }

  await supabase
    .from('document_pages')
    .update({
      processed_path: processedPath,
      qr_readable: codes.some((c) => c.type === 'qr') ? true : null,
      barcode_readable: codes.some((c) => c.type === 'barcode' || c.type === 'datamatrix') ? true : null,
      is_blurry: assessment.isBlurry,
      has_glare: assessment.hasGlare,
    })
    .eq('id', page.id)

  await supabase.from('document_events').insert({
    document_id: documentId,
    user_id: userId,
    event_type: 'reprocessed',
    meta: { page_id: page.id, options },
  })

  return { pageId: page.id, processedPath, blob: result.blob, codes }
}

/**
 * Вызывается один раз ПОСЛЕ того, как reprocessPage() отработал по всем
 * страницам документа (см. DocumentDetail.tsx → handleReprocess).
 * Пересобирает document_codes/has_qr/has_barcode с нуля по свежим
 * результатам и пересобирает сам PDF из новых обработанных страниц —
 * иначе скачиваемый файл остаётся от самой первой обработки (раздел 20 ТЗ).
 */
export async function finalizeReprocessedDocument(
  documentId: string,
  userId: string,
  pageResults: ReprocessPageResult[]
): Promise<void> {
  await supabase.from('document_codes').delete().eq('document_id', documentId)
  const codesToInsert = pageResults.flatMap((p) =>
    p.codes.map((c) => ({
      document_id: documentId,
      page_id: p.pageId,
      code_type: c.type,
      raw_value: c.rawValue,
      is_readable: true,
    }))
  )
  if (codesToInsert.length > 0) {
    await supabase.from('document_codes').insert(codesToInsert)
  }
  const hasQr = codesToInsert.some((c) => c.code_type === 'qr')
  const hasBarcode = codesToInsert.some((c) => c.code_type === 'barcode' || c.code_type === 'datamatrix')

  const pdfBlob = await buildDocumentPdf(pageResults.map((p) => p.blob))
  const pdfPath = `${userId}/${documentId}/document.pdf`
  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.pdfs)
    .upload(pdfPath, pdfBlob, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw new Error(`Не удалось пересобрать PDF: ${uploadError.message}`)

  await supabase
    .from('documents')
    .update({ has_qr: hasQr, has_barcode: hasBarcode, pdf_path: pdfPath })
    .eq('id', documentId)
}
