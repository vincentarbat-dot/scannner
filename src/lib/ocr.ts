import { PaddleOCR } from '@paddleocr/paddleocr-js'

export interface OcrItem {
  poly: number[][]
  text: string
  score: number
}

export interface OcrPageResult {
  items: OcrItem[]
  width?: number
  height?: number
  metrics?: Record<string, unknown>
}

interface PaddleOCRInstance {
  predict(input: Blob | File | string): Promise<Array<{ items?: Array<{ poly: number[][]; text: string; score: number }>; width?: number; height?: number; metrics?: Record<string, unknown> }>>
}

let ocrPromise: Promise<PaddleOCRInstance> | null = null

async function getOcr(): Promise<PaddleOCRInstance> {
  if (!ocrPromise) {
    ocrPromise = PaddleOCR.create({
      lang: 'ru',
      ocrVersion: 'PP-OCRv5',
      worker: true,
      ortOptions: {
        backend: 'wasm',
        numThreads: 2,
        simd: true,
      },
    }) as Promise<PaddleOCRInstance>
  }
  return ocrPromise
}

export async function recognizeInvoice(blob: Blob): Promise<OcrPageResult> {
  const ocr = await getOcr()
  const [result] = await ocr.predict(blob)
  return {
    items: (result?.items ?? []).map((item) => ({
      poly: item.poly,
      text: String(item.text ?? '').trim(),
      score: Number(item.score ?? 0),
    })),
    width: result?.width,
    height: result?.height,
    metrics: result?.metrics as Record<string, unknown> | undefined,
  }
}
