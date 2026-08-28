import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  // Не бросаем исключение — приложение должно открываться и показывать
  // понятный экран настройки, а не белый экран.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы. ' +
      'Скопируйте .env.example в .env и заполните значениями из Supabase.'
  )
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key'
)

// Названия storage buckets — должны совпадать с supabase/schema.sql
export const BUCKETS = {
  originals: 'originals',
  processed: 'processed',
  pdfs: 'pdfs',
} as const
