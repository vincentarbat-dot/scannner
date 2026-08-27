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

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
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
            width: { ideal: 4096 },
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
  }, [facingMode, stopStream])

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
