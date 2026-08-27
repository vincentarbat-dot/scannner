// «Улучшить документ» — раздел 21 ТЗ. Берёт уже загруженный ОРИГИНАЛ
// страницы (не трогая его — раздел 21: "оригинал при этом не изменяется"),
// прогоняет через processPage() с выбранными пользователем опциями и
// перезаписывает `processed`-файл в Storage (upsert). bounds на этом этапе
// уже не храним (страница давно снята), поэтому обрезка по границам
// документа не повторяется — только цветокоррекция/резкость/тени/контраст,
// что и просит раздел 21 (сам контур обрезки не входит в список опций там).

import { supabase, BUCKETS } from './supabase'
import { processPage, type ProcessingMode } from './imageProcessing'
import { getSignedUrl } from './storage'

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

export async function reprocessPage(
  documentId: string,
  userId: string,
  page: { id: string; original_path: string; processed_path: string | null },
  options: ReprocessOptions
): Promise<{ processedPath: string }> {
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

  await supabase.from('document_pages').update({ processed_path: processedPath }).eq('id', page.id)

  await supabase.from('document_events').insert({
    document_id: documentId,
    user_id: userId,
    event_type: 'reprocessed',
    meta: { page_id: page.id, options },
  })

  return { processedPath }
}
