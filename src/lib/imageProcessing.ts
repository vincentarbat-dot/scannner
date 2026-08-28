// Обработка снимка на клиенте (canvas) — раздел 5-7, 10 ТЗ, Часть 3.
//
// Архитектура намеренно не завязана на конкретный алгоритм: processPage()
// принимает готовый кадр + уже посчитанные bounds (см. imageQuality.ts,
// Часть 2) и отдаёт canvas с обработанной версией плюс исходный canvas
// без изменений — оригинал в handleSave (Scan.tsx / uploadDocument.ts)
// всегда грузится из ИСХОДНОГО blob страницы, эта обработка его не трогает
// (раздел 6 ТЗ: оригинал и обработанная версия — два отдельных файла).
//
// Что делает пайплайн (в этом порядке):
//   1. Обрезка по границам документа — только если bounds уверенные
//      (не касаются края кадра и покрытие разумное), иначе кадр не режем,
//      чтобы случайно не обрезать часть накладной (раздел 7: не уничтожать
//      важную информацию).
//   2. Лёгкое шумоподавление (box blur радиуса 1, смешивается с
//      оригиналом 50/50, чтобы не "размазать" мелкий текст/печати).
//   3. Выравнивание освещения / уменьшение теней — оценка фона большим
//      box blur и деление на него по каждому каналу (классический приём
//      "уборки" сканов), возвращает почти белый фон при сохранении текста.
//   4. Автоконтраст (растяжение гистограммы по перцентилям 1%/99%).
//   5. Повышение резкости (unsharp mask), в размере, безопасном для
//      QR/штрихкодов — сильное шарпенение может "сломать" модули кода,
//      поэтому усиление умеренное (раздел 8: обработка не должна портить
//      геометрию QR).
//   6. Ограничение максимального размера стороны и переэкодирование в
//      JPEG с адекватным качеством — раздел 5 "оптимизация размера файла".
//
// Цветной режим — основной (раздел 10 ТЗ: печати/подписи только в цвете).
// Оттенки серого / ч/б — доступны как опция processPage(), но по
// умолчанию не включаются; ручной выбор режима при повторной обработке
// уже загруженного документа ("Улучшить документ") — раздел 21, Часть 4.

import type { DocumentBounds } from './imageQuality'

export type ProcessingMode = 'color' | 'grayscale' | 'bw'

export interface ProcessOptions {
  mode?: ProcessingMode
  /** Не обрезать по границам, даже если они уверенные (для ручной пересъёмки/файла) */
  skipCrop?: boolean
  /** Максимальная длинная сторона результата, px */
  maxDimension?: number
  /** Качество JPEG 0..1 */
  jpegQuality?: number
  /** Шумоподавление (шаг 2) — можно выключить при повторной обработке (раздел 21 ТЗ) */
  denoise?: boolean
  /** Выравнивание освещения / удаление теней (шаг 3, раздел 21 "убрать тени") */
  flattenShadows?: boolean
  /** Автоконтраст (шаг 4, раздел 21 "улучшить контраст") */
  autoContrastEnabled?: boolean
  /** Резкость (шаг 5, раздел 21 "повысить резкость") */
  sharpen?: boolean
}

export interface ProcessResult {
  blob: Blob
  dataUrl: string
  width: number
  height: number
  /** Был ли применён автообрез по границам документа */
  cropped: boolean
}

const DEFAULTS: Required<ProcessOptions> = {
  mode: 'color',
  skipCrop: false,
  maxDimension: 2000,
  jpegQuality: 0.85,
  denoise: true,
  flattenShadows: true,
  autoContrastEnabled: true,
  sharpen: true,
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось загрузить изображение для обработки'))
    img.src = dataUrl
  })
}

// Разделяемый box blur (гориз. + верт. проход) со скользящей суммой —
// O(width*height) независимо от радиуса, с расширением края (clamp).
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice()
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  const windowSize = radius * 2 + 1

  // горизонтальный проход
  for (let y = 0; y < height; y++) {
    const rowOff = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      const xc = x < 0 ? 0 : x >= width ? width - 1 : x
      sum += src[rowOff + xc]
    }
    for (let x = 0; x < width; x++) {
      tmp[rowOff + x] = sum / windowSize
      const nextX = x + radius + 1
      const prevX = x - radius
      const nextC = nextX >= width ? width - 1 : nextX
      const prevC = prevX < 0 ? 0 : prevX
      sum += src[rowOff + nextC] - src[rowOff + prevC]
    }
  }

  // вертикальный проход
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      const yc = y < 0 ? 0 : y >= height ? height - 1 : y
      sum += tmp[yc * width + x]
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / windowSize
      const nextY = y + radius + 1
      const prevY = y - radius
      const nextC = nextY >= height ? height - 1 : nextY
      const prevC = prevY < 0 ? 0 : prevY
      sum += tmp[nextC * width + x] - tmp[prevC * width + x]
    }
  }

  return out
}

interface Channels {
  r: Float32Array
  g: Float32Array
  b: Float32Array
  width: number
  height: number
}

function toChannels(imageData: ImageData): Channels {
  const { data, width, height } = imageData
  const n = width * height
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    r[p] = data[i]
    g[p] = data[i + 1]
    b[p] = data[i + 2]
  }
  return { r, g, b, width, height }
}

function fromChannels(ch: Channels): ImageData {
  const { r, g, b, width, height } = ch
  const out = new ImageData(width, height)
  for (let p = 0, i = 0; p < r.length; p++, i += 4) {
    out.data[i] = clamp255(r[p])
    out.data[i + 1] = clamp255(g[p])
    out.data[i + 2] = clamp255(b[p])
    out.data[i + 3] = 255
  }
  return out
}

// Уменьшение шума: смешиваем со слегка размытой версией (не полное
// заглаживание, чтобы не потерять мелкий текст/контуры печати).
function denoiseChannel(c: Float32Array, width: number, height: number): Float32Array {
  const blurred = boxBlur(c, width, height, 1)
  const out = new Float32Array(c.length)
  for (let i = 0; i < c.length; i++) out[i] = c[i] * 0.55 + blurred[i] * 0.45
  return out
}

// Выравнивание освещения / уменьшение теней: оцениваем "фон" крупным
// блюром и делим на него, приводя фон к целевой яркости. Работает похоже
// на flat-field коррекцию в сканерах — тени и неравномерная засветка
// сглаживаются, а тёмный текст поверх фона остаётся тёмным.
function flattenIllumination(c: Float32Array, width: number, height: number, target = 232): Float32Array {
  const radius = Math.max(8, Math.round(Math.min(width, height) / 6))
  const background = boxBlur(c, width, height, radius)
  const out = new Float32Array(c.length)
  for (let i = 0; i < c.length; i++) {
    const bg = Math.max(background[i], 12)
    out[i] = clamp255((c[i] / bg) * target)
  }
  return out
}

// Автоконтраст по перцентилям яркости (общий для всех каналов масштаб,
// чтобы не "уехать" в цвете).
function autoContrast(ch: Channels): Channels {
  const n = ch.r.length
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = 0.299 * ch.r[i] + 0.587 * ch.g[i] + 0.114 * ch.b[i]
  const sorted = Array.from(lum).sort((a, b) => a - b)
  const lo = sorted[Math.floor(n * 0.01)] ?? 0
  const hi = sorted[Math.floor(n * 0.99)] ?? 255
  if (hi - lo < 10) return ch // почти нет контраста для растяжения — пропускаем, чтобы не усилить шум
  const scale = 255 / (hi - lo)
  const apply = (v: number) => clamp255((v - lo) * scale)
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    r[i] = apply(ch.r[i])
    g[i] = apply(ch.g[i])
    b[i] = apply(ch.b[i])
  }
  return { r, g, b, width: ch.width, height: ch.height }
}

// Unsharp mask с умеренным усилением — раздел 8 ТЗ прямо требует не
// портить геометрию QR-кода избыточной обработкой.
function sharpenChannel(c: Float32Array, width: number, height: number, amount = 0.55): Float32Array {
  const blurred = boxBlur(c, width, height, 2)
  const out = new Float32Array(c.length)
  for (let i = 0; i < c.length; i++) out[i] = clamp255(c[i] + (c[i] - blurred[i]) * amount)
  return out
}

function applyMode(ch: Channels, mode: ProcessingMode): Channels {
  if (mode === 'color') return ch
  const n = ch.r.length
  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) gray[i] = 0.299 * ch.r[i] + 0.587 * ch.g[i] + 0.114 * ch.b[i]
  if (mode === 'grayscale') return { r: gray, g: gray.slice(), b: gray.slice(), width: ch.width, height: ch.height }
  // bw: бинаризация по Оцу-приближению (порог = среднее) — используется
  // только когда пользователь осознанно выбрал ч/б режим (Часть 4,
  // раздел 21), не по умолчанию, т.к. может ухудшить читаемость печати.
  let sum = 0
  for (let i = 0; i < n; i++) sum += gray[i]
  const threshold = sum / n
  const bw = new Float32Array(n)
  for (let i = 0; i < n; i++) bw[i] = gray[i] >= threshold ? 255 : 0
  return { r: bw, g: bw.slice(), b: bw.slice(), width: ch.width, height: ch.height }
}

function canvasToBlobAndUrl(canvas: HTMLCanvasElement, quality: number): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Не удалось закодировать обработанное изображение'))
          return
        }
        resolve({ blob, dataUrl: canvas.toDataURL('image/jpeg', quality) })
      },
      'image/jpeg',
      quality
    )
  })
}

export async function processPage(
  sourceDataUrl: string,
  bounds: DocumentBounds | null,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const opts = { ...DEFAULTS, ...options }
  const img = await loadImage(sourceDataUrl)

  // 1. Обрезка — только если границы уверенные (не упираются в край, и
  // покрытие кадра документом не подозрительно маленькое). Небольшой
  // отступ (1.5%), чтобы не обрезать край листа вместе с текстом/QR.
  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  let cropped = false
  if (!opts.skipCrop && bounds && !bounds.touchesEdge && bounds.coverage > 0.2) {
    const pad = 0.015
    const x0 = Math.max(0, bounds.x - pad)
    const y0 = Math.max(0, bounds.y - pad)
    const x1 = Math.min(1, bounds.x + bounds.width + pad)
    const y1 = Math.min(1, bounds.y + bounds.height + pad)
    sx = Math.round(x0 * img.naturalWidth)
    sy = Math.round(y0 * img.naturalHeight)
    sw = Math.round((x1 - x0) * img.naturalWidth)
    sh = Math.round((y1 - y0) * img.naturalHeight)
    if (sw > 20 && sh > 20) cropped = true
    else {
      sx = 0
      sy = 0
      sw = img.naturalWidth
      sh = img.naturalHeight
    }
  }

  // Ограничение размера обработки — вниз, если исходник больше maxDimension.
  const longSide = Math.max(sw, sh)
  const scale = longSide > opts.maxDimension ? opts.maxDimension / longSide : 1
  const outW = Math.max(1, Math.round(sw * scale))
  const outH = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)

  const imageData = ctx.getImageData(0, 0, outW, outH)
  let channels = toChannels(imageData)

  // 2. Шумоподавление
  if (opts.denoise) {
    channels = {
      ...channels,
      r: denoiseChannel(channels.r, outW, outH),
      g: denoiseChannel(channels.g, outW, outH),
      b: denoiseChannel(channels.b, outW, outH),
    }
  }

  // 3. Выравнивание освещения / тени
  if (opts.flattenShadows) {
    channels = {
      ...channels,
      r: flattenIllumination(channels.r, outW, outH),
      g: flattenIllumination(channels.g, outW, outH),
      b: flattenIllumination(channels.b, outW, outH),
    }
  }

  // 4. Автоконтраст
  if (opts.autoContrastEnabled) channels = autoContrast(channels)

  // 5. Резкость
  if (opts.sharpen) {
    channels = {
      ...channels,
      r: sharpenChannel(channels.r, outW, outH),
      g: sharpenChannel(channels.g, outW, outH),
      b: sharpenChannel(channels.b, outW, outH),
    }
  }

  // 6. Цветовой режим (по умолчанию остаётся цветным)
  channels = applyMode(channels, opts.mode)

  ctx.putImageData(fromChannels(channels), 0, 0)

  const { blob, dataUrl } = await canvasToBlobAndUrl(canvas, opts.jpegQuality)
  return { blob, dataUrl, width: outW, height: outH, cropped }
}
