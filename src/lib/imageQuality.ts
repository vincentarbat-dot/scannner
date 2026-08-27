// Эвристики контроля качества кадра — разделы 3, 4, 11 ТЗ.
//
// Первая итерация (Часть 2, см. PROGRESS.md): без OpenCV.js, всё на 2D
// canvas. Определение границ документа — упрощённое (axis-aligned
// прямоугольник по проекции градиентов), а не полный четырёхугольник
// с коррекцией перспективы. Если на реальных снимках точности не
// хватит — следующий шаг: OpenCV.js (contour + minAreaRect), сама
// архитектура (analyzeFrame → FrameMetrics → pickHint/scorePage) под
// замену метода детекции не заточена жёстко.

export interface DocumentBounds {
  /** Координаты и размер — доли от ширины/высоты кадра (0..1) */
  x: number
  y: number
  width: number
  height: number
  /** Доля кадра, занимаемая документом */
  coverage: number
  /** Прямоугольник упирается в край кадра — документ, вероятно, обрезан */
  touchesEdge: boolean
}

export interface FrameMetrics {
  /** Дисперсия Лапласиана: чем выше, тем резче кадр */
  sharpness: number
  /** Средняя яркость, 0..255 */
  brightness: number
  /** Доля пересвеченных пикселей, 0..1 */
  glareRatio: number
  bounds: DocumentBounds | null
  /** Отличие от предыдущего кадра (прокси стабильности удержания камеры), 0..1 */
  movement: number
}

export const ANALYSIS_WIDTH = 220

const THRESHOLDS = {
  sharpnessOk: 18,
  brightnessMin: 55,
  brightnessMax: 235,
  glareMax: 0.035,
  movementMax: 0.012,
  coverageMin: 0.15,
  coverageGood: 0.35,
}

interface GrayFrame {
  data: Float32Array
  width: number
  height: number
}

export function toGrayscale(imageData: ImageData): GrayFrame {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return { data: gray, width, height }
}

function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += lap
      sumSq += lap * lap
      count++
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSq / count - mean * mean
}

function meanBrightness(gray: Float32Array): number {
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  return sum / gray.length
}

function computeGlareRatio(gray: Float32Array, threshold = 248): number {
  let over = 0
  for (let i = 0; i < gray.length; i++) if (gray[i] >= threshold) over++
  return over / gray.length
}

function computeMovement(prev: Float32Array | null, gray: Float32Array): number {
  if (!prev || prev.length !== gray.length) return 0
  let diff = 0
  for (let i = 0; i < gray.length; i++) diff += Math.abs(prev[i] - gray[i])
  return diff / gray.length / 255
}

// Упрощённое определение границ документа: по карте градиентов (Собель)
// ищем строки/столбцы с высокой концентрацией края — предполагается, что
// накладная лежит на контрастном фоне. Возвращает axis-aligned
// прямоугольник — см. заметку в шапке файла.
function detectDocumentBounds(gray: Float32Array, width: number, height: number): DocumentBounds | null {
  const mag = new Float32Array(width * height)
  let sum = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx = gray[i + 1] - gray[i - 1]
      const gy = gray[i + width] - gray[i - width]
      const m = Math.hypot(gx, gy)
      mag[i] = m
      sum += m
    }
  }
  const mean = sum / mag.length
  let sqSum = 0
  for (let i = 0; i < mag.length; i++) sqSum += (mag[i] - mean) ** 2
  const std = Math.sqrt(sqSum / mag.length)
  const edgeThreshold = mean + std * 0.8

  const rowSum = new Float32Array(height)
  const colSum = new Float32Array(width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mag[y * width + x] > edgeThreshold) {
        rowSum[y]++
        colSum[x]++
      }
    }
  }

  const rowLimit = width * 0.12
  const colLimit = height * 0.12
  const findFirst = (arr: Float32Array, limit: number) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] > limit) return i
    return -1
  }
  const findLast = (arr: Float32Array, limit: number) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] > limit) return i
    return -1
  }

  const top = findFirst(rowSum, rowLimit)
  const bottom = findLast(rowSum, rowLimit)
  const left = findFirst(colSum, colLimit)
  const right = findLast(colSum, colLimit)
  if (top < 0 || left < 0 || bottom <= top || right <= left) return null

  const boxWidth = right - left
  const boxHeight = bottom - top
  const coverage = (boxWidth * boxHeight) / (width * height)
  if (coverage < THRESHOLDS.coverageMin) return null

  const margin = 2
  const touchesEdge =
    left <= margin || top <= margin || right >= width - 1 - margin || bottom >= height - 1 - margin

  return {
    x: left / width,
    y: top / height,
    width: boxWidth / width,
    height: boxHeight / height,
    coverage,
    touchesEdge,
  }
}

export function analyzeFrame(
  imageData: ImageData,
  prevGray: Float32Array | null
): { metrics: FrameMetrics; gray: Float32Array } {
  const { data: gray, width, height } = toGrayscale(imageData)
  const metrics: FrameMetrics = {
    sharpness: laplacianVariance(gray, width, height),
    brightness: meanBrightness(gray),
    glareRatio: computeGlareRatio(gray),
    bounds: detectDocumentBounds(gray, width, height),
    movement: computeMovement(prevGray, gray),
  }
  return { metrics, gray }
}

export type HintKind = 'frame' | 'dark' | 'glare' | 'blur' | 'detected'

export interface HintResult {
  kind: HintKind
  message: string
}

// Порядок проверок задаёт приоритет подсказок — раздел 3 ТЗ. Свет и блики
// важнее рамки: без нормального освещения остальные метрики ненадёжны.
export function pickHint(m: FrameMetrics): HintResult {
  if (m.brightness < THRESHOLDS.brightnessMin) {
    return { kind: 'dark', message: 'Недостаточно освещения' }
  }
  if (m.glareRatio > THRESHOLDS.glareMax) {
    return { kind: 'glare', message: 'Измените угол съёмки' }
  }
  if (!m.bounds || m.bounds.touchesEdge) {
    return { kind: 'frame', message: 'Наведите камеру на весь документ' }
  }
  if (m.movement > THRESHOLDS.movementMax) {
    return { kind: 'blur', message: 'Удерживайте телефон неподвижно' }
  }
  if (m.sharpness < THRESHOLDS.sharpnessOk) {
    return { kind: 'blur', message: 'Удерживайте телефон неподвижно' }
  }
  return { kind: 'detected', message: 'Документ обнаружен' }
}

export function isCaptureReady(m: FrameMetrics): boolean {
  return pickHint(m).kind === 'detected'
}

export interface PageQuality {
  score: number
  warnings: string[]
}

// Итоговая оценка уже снятой страницы (0..100) — экран проверки, раздел 11
// ТЗ. Полноценный расчёт с учётом QR/штрихкода/печати — Часть 3; здесь
// агрегируются только метрики, доступные на этапе съёмки.
// Итоговая оценка документа (Часть 3, раздел 11 ТЗ) — агрегирует уже
// посчитанные оценки страниц (scorePage(), метрики съёмки) с результатами
// детекта кодов после обработки. Не пересчитывает резкость/свет заново —
// это домен scorePage(); здесь только сведение в один процент + причины
// для карточки "Качество документа: N%".
export interface DocumentQualityInput {
  pageScores: number[]
  /** Хотя бы один код был найден на странице, но НЕ читается после обработки */
  hasUnreadableCode: boolean
  /** На документе вообще не найдено ни одного кода (не всегда проблема — не у всех накладных есть QR) */
  codesExpectedButMissing?: boolean
}

export function scoreDocumentOverall(input: DocumentQualityInput): PageQuality {
  const { pageScores, hasUnreadableCode } = input
  const warnings: string[] = []
  if (pageScores.length === 0) return { score: 0, warnings: ['Нет ни одной страницы'] }

  let score = pageScores.reduce((s, v) => s + v, 0) / pageScores.length

  if (hasUnreadableCode) {
    warnings.push('QR-код или штрихкод плохо читается')
    score -= 15
  }

  const weakPages = pageScores.filter((s) => s < 60).length
  if (weakPages > 0) {
    warnings.push(`${weakPages} стр. низкого качества — рекомендуется переснять`)
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), warnings }
}

export function scorePage(m: FrameMetrics): PageQuality {
  const warnings: string[] = []
  let score = 100

  const sharpnessScore = Math.min(1, m.sharpness / (THRESHOLDS.sharpnessOk * 2.2))
  if (sharpnessScore < 0.6) warnings.push('Возможно смазано — рекомендуется переснять')
  score -= (1 - sharpnessScore) * 40

  if (m.brightness < THRESHOLDS.brightnessMin) {
    warnings.push('Недостаточно освещения')
    score -= 20
  } else if (m.brightness > THRESHOLDS.brightnessMax) {
    warnings.push('Слишком яркое изображение')
    score -= 10
  }

  if (m.glareRatio > THRESHOLDS.glareMax) {
    warnings.push('Обнаружен блик')
    score -= 20
  }

  if (!m.bounds) {
    warnings.push('Границы документа не определены')
    score -= 15
  } else {
    if (m.bounds.touchesEdge) {
      warnings.push('Документ обрезан краем кадра')
      score -= 20
    }
    if (m.bounds.coverage < THRESHOLDS.coverageGood) {
      warnings.push('Документ занимает малую часть кадра')
      score -= 10
    }
  }

  return { score: Math.max(0, Math.round(score)), warnings }
}
