// Системные настройки — таблица public.app_settings (миграция 002_part4.sql).
// Пока используется только для автоматической смены статуса накладной
// после загрузки (раздел 18 ТЗ), но структура key/value позволяет добавить
// другие настройки позже, не трогая схему.

import { supabase } from './supabase'

export interface AutoStatusSetting {
  enabled: boolean
  quality_threshold: number
}

const DEFAULT_AUTO_STATUS: AutoStatusSetting = { enabled: false, quality_threshold: 70 }

export async function getAutoStatusSetting(): Promise<AutoStatusSetting> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'auto_status').single()
  if (error || !data) return DEFAULT_AUTO_STATUS
  const value = data.value as Partial<AutoStatusSetting>
  return {
    enabled: Boolean(value.enabled),
    quality_threshold:
      typeof value.quality_threshold === 'number' ? value.quality_threshold : DEFAULT_AUTO_STATUS.quality_threshold,
  }
}

export async function setAutoStatusSetting(value: AutoStatusSetting): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .update({ value })
    .eq('key', 'auto_status')
  return { error: error?.message ?? null }
}
