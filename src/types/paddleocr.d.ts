declare module '@paddleocr/paddleocr-js' {
  export interface PaddleOCRItem {
    poly: number[][]
    text: string
    score: number
  }

  export interface PaddleOCRResult {
    items: PaddleOCRItem[]
    width?: number
    height?: number
    metrics?: Record<string, unknown>
  }

  export interface PaddleOCRPredictor {
    predict(input: Blob | File | string): Promise<[PaddleOCRResult, ...PaddleOCRResult[]]>
  }

  export const PaddleOCR: {
    create(options: {
      lang: string
      ocrVersion: string
      worker: boolean
      ortOptions: {
        backend: 'wasm'
        numThreads: number
        simd: boolean
      }
    }): Promise<PaddleOCRPredictor>
  }
}
