// Обёртка над официальным PaddleOCR.js (`@paddleocr/paddleocr-js`) — раздел
// 13 ТЗ, Часть 5. Движок выбран пользователем ещё в Части 3 (см.
// PROGRESS.md), сама интеграция — здесь, по прямому запросу пользователя
// в начале Части 5.
//
// ЧЕСТНО ПРО ПРОВЕРКУ СОВМЕСТИМОСТИ (сделана перед реализацией, как и
// просил пользователь): у Claude в этой песочнице нет сетевого доступа —
// `npm install @paddleocr/paddleocr-js` физически невозможен, поэтому
// исходники/типы пакета открыть и свериться напрямую нельзя было. Код
// ниже написан по официальной документации пакета (npmjs.com/package/
// @paddleocr/paddleocr-js, дата публикации версии 0.4.2 — проверено
// веб-поиском непосредственно перед началом Части 5) и намеренно
// defensive в месте разбора результата predict() — см. normalizeItem()
// ниже: перебирает разумные варианты названий полей вместо жёсткой
// привязки к одной форме ответа. Обязательно прогнать `npm install &&
// npm run dev` у себя и свериться с реальными типами пакета
// (`node_modules/@paddleocr/paddleocr-js`); если форма ответа отличается —
// поправить только normalizeItem(), остальной код (парсинг полей,
// интеграция в uploadDocument.ts/DocumentDetail.tsx) от точной формы
// ответа не зависит.
//
// Язык: lang: 'ru' — по документации PP-OCRv5 это модель распознавания
// кириллицы (cyrillic_PP-OCRv5_*_rec). Специфические казахские буквы
// (қ/ә/і/ң/ғ/ұ/ү/һ/ө) этой моделью могут распознаваться хуже обычной
// кириллицы — ограничение самой модели PaddleOCR, не обёртки; отдельной
// казахской recognition-модели PP-OCRv5 на момент проверки не было.
//
// Web Worker: пакет поддерживает встроенный режим `worker: true` в
// PaddleOCR.create() — сам поднимает Worker и гоняет инференс там, поэтому
// самодельный Worker здесь не нужен: тяжёлые вычисления не блокируют
// интерфейс камеры/карточки документа, как и просит пользователь.
//
// COOP/COEP и многопоточный WASM: см. netlify.toml — COOP: same-origin +
// COEP: credentialless выставлены на весь сайт. `credentialless` (в
// отличие от `require-corp`) не требует от Supabase Storage заголовка
// Cross-Origin-Resource-Policy на подписанные ссылки картинок в карточке
// документа (DocumentDetail.tsx), поэтому существующие <img> не ломаются,
// а движок при этом получает crossOriginIsolated-контекст для
// многопоточного WASM, если `backend: 'auto'` решит им воспользоваться (на
// слабых телефонах может остаться однопоточным — это ок, просто медленнее).
//
// Модели/WASM-рантайм: ortOptions.wasmPaths указывает на jsDelivr CDN —
// это ровно то, что показано в официальном примере пакета. Сами ONNX-
// модели PP-OCRv5 (детекция+распознавание) `PaddleOCR.create()`, судя по
// документации, подтягивает откуда-то самостоятельно (в примере нет
// параметров вроде detPath/recPath, в отличие от неофициальных SDK) —
// значит, по умолчанию они тоже грузятся с CDN самого пакета при первом
// запуске и кешируются браузером. Это НЕ отдельный "внешний сервис" в
// смысле ТЗ (не бэкенд, не API с ключом, ничего не отправляется наружу
// с накладной) — просто статическая раздача файлов, как и шрифты/иконки
// с CDN. Если хочется полностью убрать любую внешнюю сеть в рантайме —
// нужно самостоятельно скачать веса из node_modules/@paddleocr/
// paddleocr-js после `npm install`, положить в `public/ocr-models/` и
// передать локальные пути через параметры create() (см. README пакета на
// момент установки — состав параметров мог измениться).

import { PaddleOCR } from '@paddleocr/paddleocr-js'
import type { OcrTextLine } from './types'

// Минимальный интерфейс того, чем реально пользуемся из движка — не весь
// полный тип пакета (см. предупреждение в шапке файла).
interface PaddleOcrEngine {
  predict(input: Blob): Promise<unknown[]>
}

let enginePromise: Promise<PaddleOcrEngine> | null = null

async function createEngine(): Promise<PaddleOcrEngine> {
  const engine = await PaddleOCR.create({
    lang: 'ru',
    ocrVersion: 'PP-OCRv5',
    worker: true,
    ortOptions: {
      backend: 'auto',
      wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/',
    },
  })
  return engine as unknown as PaddleOcrEngine
}

function getEngine(): Promise<PaddleOcrEngine> {
  if (!enginePromise) {
    // Не кешируем провалившуюся инициализацию — если причина временная
    // (например, сеть моргнула при первой загрузке модели), следующий
    // вызов должен иметь шанс попробовать снова, а не быть обречён на
    // тот же отвергнутый промис навсегда.
    enginePromise = createEngine().catch((err) => {
      enginePromise = null
      throw err
    })
  }
  return enginePromise
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Разные сборки/версии OCR-обёрток по-разному называют поля одной
// распознанной строки (text/rec_text/transcription, box/bbox/polygon,
// score/confidence). Перебираем разумные варианты, а не привязываемся к
// одной форме — см. предупреждение в шапке файла.
function normalizeItem(raw: unknown): OcrTextLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = toText(r.text ?? r.rec_text ?? r.transcription ?? r.label)
  if (!text.trim()) return null

  const confidence = toNumber(r.score ?? r.confidence ?? r.rec_score)

  // box может быть полигоном [[x,y],[x,y],[x,y],[x,y]] либо
  // {x,y,width,height} — приводим оба варианта к прямоугольнику.
  const box = r.box ?? r.bbox ?? r.polygon ?? r.points
  let x = 0
  let y = 0
  let width = 0
  let height = 0
  if (Array.isArray(box) && box.length > 0) {
    const xs: number[] = []
    const ys: number[] = []
    for (const point of box) {
      if (Array.isArray(point) && point.length >= 2) {
        xs.push(Number(point[0]))
        ys.push(Number(point[1]))
      }
    }
    if (xs.length > 0 && ys.length > 0) {
      x = Math.min(...xs)
      y = Math.min(...ys)
      width = Math.max(...xs) - x
      height = Math.max(...ys) - y
    }
  } else if (box && typeof box === 'object') {
    const b = box as Record<string, unknown>
    x = toNumber(b.x) ?? 0
    y = toNumber(b.y) ?? 0
    width = toNumber(b.width) ?? 0
    height = toNumber(b.height) ?? 0
  }

  return { text: text.trim(), confidence, x, y, width, height }
}

/**
 * Распознаёт текст на одном изображении. Раздел 13 ТЗ + прямое требование
 * пользователя: сюда всегда должна передаваться ОБРАБОТАННАЯ версия
 * страницы (после imageProcessing.ts — выровненный свет, автоконтраст,
 * резкость), не оригинал — вызывающий код (uploadDocument.ts,
 * DocumentDetail.tsx) это соблюдает.
 */
export async function recognizeImage(image: Blob): Promise<OcrTextLine[]> {
  const engine = await getEngine()
  const results = await engine.predict(image)
  const first = results[0] as { items?: unknown[] } | undefined
  const items = first?.items ?? []
  return items.map(normalizeItem).filter((item): item is OcrTextLine => item !== null)
}
