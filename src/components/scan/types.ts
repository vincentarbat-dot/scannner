import type { DocumentBounds } from '../../lib/imageQuality'

export interface CapturedPage {
  id: string
  dataUrl: string
  blob: Blob
  /** Оценка качества страницы 0..100 — см. scorePage() в src/lib/imageQuality.ts */
  score: number
  warnings: string[]
  /** Кадр снят автоматически (для аналитики/раздела 26 ТЗ в будущих частях) */
  auto: boolean
  /** Границы документа на момент съёмки (для автообреза в обработке — Часть 3) */
  bounds: DocumentBounds | null
}
