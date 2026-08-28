// Бакеты (`originals`/`processed`/`pdfs`) приватные — раздел 24 ТЗ
// ("файлы должны храниться в защищённом хранилище"), поэтому для показа
// и скачивания файлов в карточке документа нужны подписанные ссылки,
// а не публичные URL.

import { supabase } from './supabase'

const SIGNED_URL_TTL_SECONDS = 60 * 10 // 10 минут — достаточно для просмотра/скачивания одной сессии

export async function getSignedUrl(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}
