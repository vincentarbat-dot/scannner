import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface UseCameraResult {
  videoRef: RefObject<HTMLVideoElement | null>
  /** Видео получает кадры и готово к отрисовке/анализу */
  ready: boolean
  error: string | null
  facingMode: 'environment' | 'user'
  canToggleFacing: boolean
  toggleFacing: () => void
}

// Доступ к камере через браузер, максимальное доступное разрешение,
// по умолчанию — тыловая камера (раздел 3 ТЗ).
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  // Баг-фикс: чёрный экран/полосы при повороте телефона (см. PROGRESS.md).
  // Помимо CSS-заглушки на /scan (index.css .landscape-guard), здесь —
  // пересоздание MediaStream при повороте: некоторые Android-браузеры
  // оставляют видео-поток в "битом" состоянии после смены ориентации,
  // и единственный надёжный способ вернуть чистую картинку — открыть
  // поток заново, а не пытаться починить уже идущий.
  const [restartToken, setRestartToken] = useState(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    const handleOrientationChange = () => {
      // Небольшая задержка: события ориентации на части устройств
      // приходят до того, как браузер закончил перекомпоновку layout —
      // пересоздаём поток уже после того, как всё устаканилось.
      window.setTimeout(() => setRestartToken((t) => t + 1), 300)
    }
    window.addEventListener('orientationchange', handleOrientationChange)
    return () => window.removeEventListener('orientationchange', handleOrientationChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Камера недоступна в этом браузере.')
        return
      }
      stopStream()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            // Раньше здесь было 4096×2160 — нестандартное соотношение
            // сторон (~17:9), которое не совпадает ни с одним типичным
            // сенсором (4:3 или 16:9). На части телефонов это заставляло
            // драйвер камеры подгонять/обрезать кадр, что усиливало
            // артефакты при любой ренеготиации потока (в т.ч. при
            // повороте экрана). 3840×2160 (честные 4K, 16:9) — разрешение
            // максимально высокое, но соответствует реальным профилям
            // камер, поэтому стабильнее (раздел 3 ТЗ: "максимально
            // доступное разрешение", а не обязательно 4096 по ширине).
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {
            // autoplay может быть заблокирован до жеста пользователя — не критично,
            // элементы управления всё равно доступны после взаимодействия.
          })
        }
        if (!cancelled) setReady(true)
      } catch (e) {
        if (cancelled) return
        const err = e as DOMException
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          setError('Нет доступа к камере. Разрешите доступ в настройках браузера.')
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          setError('Подходящая камера не найдена на устройстве.')
        } else {
          setError('Не удалось запустить камеру. Попробуйте ещё раз.')
        }
      }
    }

    start()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [facingMode, stopStream, restartToken])

  const toggleFacing = useCallback(() => {
    setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'))
  }, [])

  return {
    videoRef,
    ready,
    error,
    facingMode,
    canToggleFacing: true,
    toggleFacing,
  }
}
