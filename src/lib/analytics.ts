// Аналитика для админ-панели — раздел 26 ТЗ. Все счётчики читаются
// через count-запросы (head:true — не тянут строки) плюс одна выборка
// для группировки по поставщику (агрегация на клиенте, т.к. без
// server-side RPC это проще и для MVP-объёмов данных достаточно быстро).

import { supabase } from './supabase'

export interface AnalyticsSummary {
  totalDocuments: number
  documentsToday: number
  documentsThisMonth: number
  lowQualityScans: number
  retakes: number
  sentToAccounting: number
  bySupplier: Array<{ supplier: string; count: number }>
}

const LOW_QUALITY_THRESHOLD = 60

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfMonthIso(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function loadAnalytics(): Promise<AnalyticsSummary> {
  const [
    { count: totalDocuments },
    { count: documentsToday },
    { count: documentsThisMonth },
    { count: lowQualityScans },
    { count: retakes },
    { count: sentToAccounting },
    supplierRows,
  ] = await Promise.all([
    supabase.from('documents').select('*', { count: 'exact', head: true }),
    supabase.from('documents').select('*', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
    supabase.from('documents').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonthIso()),
    supabase.from('documents').select('*', { count: 'exact', head: true }).lt('quality_score', LOW_QUALITY_THRESHOLD),
    supabase.from('document_events').select('*', { count: 'exact', head: true }).eq('event_type', 'retake'),
    supabase.from('documents').select('*', { count: 'exact', head: true }).eq('status', 'sent_to_accounting'),
    supabase.from('documents').select('supplier_name').not('supplier_name', 'is', null).limit(2000),
  ])

  const counts = new Map<string, number>()
  for (const row of (supplierRows.data as Array<{ supplier_name: string | null }>) ?? []) {
    const name = row.supplier_name?.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const bySupplier = Array.from(counts.entries())
    .map(([supplier, count]) => ({ supplier, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  return {
    totalDocuments: totalDocuments ?? 0,
    documentsToday: documentsToday ?? 0,
    documentsThisMonth: documentsThisMonth ?? 0,
    lowQualityScans: lowQualityScans ?? 0,
    retakes: retakes ?? 0,
    sentToAccounting: sentToAccounting ?? 0,
    bySupplier,
  }
}
