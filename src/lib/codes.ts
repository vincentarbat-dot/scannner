// Детект QR / штрихкод / Data Matrix — разделы 8, 9, 14 ТЗ, Часть 3.
//
// Используем @zxing/library (уже в зависимостях, см. PROGRESS.md "Часть 1").
// Библиотека умеет decode() только один код за проход — для MVP этого
// достаточно (на практике на накладной обычно один машиночитаемый код);
// расширение до нескольких кодов на странице через GenericMultipleBarcodeReader
// — по необходимости, архитектура (detectCodes возвращает массив) под это
// не завязана жёстко.
//
// Код должен проверяться и ДО, и ПОСЛЕ обработки изображения (раздел 8-9):
// вызывающая сторона (uploadDocument.ts) гоняет detectCodes() на исходном
// canvas и на обработанном отдельно и сравнивает результат.

import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'

export type CodeType = 'qr' | 'barcode' | 'datamatrix'

export interface CodeDetection {
  type: CodeType
  rawValue: string
}

function mapFormat(format: BarcodeFormat): CodeType {
  if (format === BarcodeFormat.QR_CODE) return 'qr'
  if (format === BarcodeFormat.DATA_MATRIX) return 'datamatrix'
  return 'barcode'
}

const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
    ],
  ],
])

function imageDataToBinaryBitmap(imageData: ImageData): BinaryBitmap {
  const { data, width, height } = imageData
  const packed = new Int32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    packed[p] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  }
  const source = new RGBLuminanceSource(packed, width, height)
  return new BinaryBitmap(new HybridBinarizer(source))
}

// Пытается найти один машиночитаемый код на изображении. Возвращает
// пустой массив, если ничего не найдено (это нормальный исход — не
// у каждой накладной есть QR/штрихкод).
export function detectCodes(source: HTMLCanvasElement | ImageData): CodeDetection[] {
  let imageData: ImageData
  if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext('2d')
    if (!ctx) return []
    imageData = ctx.getImageData(0, 0, source.width, source.height)
  } else {
    imageData = source
  }

  const reader = new MultiFormatReader()
  try {
    const bitmap = imageDataToBinaryBitmap(imageData)
    const result = reader.decode(bitmap, HINTS)
    return [{ type: mapFormat(result.getBarcodeFormat()), rawValue: result.getText() }]
  } catch {
    // NotFoundException и т.п. — код не найден, это ожидаемый исход
    return []
  }
}

export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось загрузить изображение для детекта кодов'))
    image.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx?.drawImage(img, 0, 0)
  return canvas
}
