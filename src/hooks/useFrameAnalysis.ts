import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ANALYSIS_WIDTH, analyzeFrame } from '../lib/imageQuality'
import type { FrameMetrics } from '../lib/imageQuality'

const ANALYSIS_INTERVAL_MS = 120 // ~8 кадров/сек — достаточно для подсказок, дёшево по CPU

// Периодически берёт кадр с видео, уменьшает и прогоняет через эвристики
// качества (см. src/lib/imageQuality.ts). Возвращает последние метрики.
export function useFrameAnalysis(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean
): FrameMetrics | null {
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const prevGrayRef = useRef<Float32Array | null>(null)
  const lastRunRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setMetrics(null)
      prevGrayRef.current = null
      return
    }
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    let rafId = 0

    const loop = (t: number) => {
      rafId = requestAnimationFrame(loop)
      if (t - lastRunRef.current < ANALYSIS_INTERVAL_MS) return
      lastRunRef.current = t

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return

      const w = ANALYSIS_WIDTH
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, w, h)

      let imageData: ImageData
      try {
        imageData = ctx.getImageData(0, 0, w, h)
      } catch {
        return // например, SecurityError на файловом протоколе — просто пропускаем кадр
      }

      const { metrics: m, gray } = analyzeFrame(imageData, prevGrayRef.current)
      prevGrayRef.current = gray
      setMetrics(m)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [active, videoRef])

  return metrics
}
