import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface UseCameraResult {
  videoRef: RefObject<HTMLVideoElement | null>
  ready: boolean
  error: string | null
  facingMode: 'environment' | 'user'
  canToggleFacing: boolean
  toggleFacing: () => void
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] =
    useState<'environment' | 'user'>('environment')

  const stopStream = useCallback(() => {
    const stream = streamRef.current

    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })

      streamRef.current = null
    }

    const video = videoRef.current

    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна в этом браузере.')
      return
    }

    setReady(false)
    setError(null)

    stopStream()

    try {
      // Даём браузеру немного времени освободить предыдущую камеру
      await new Promise((resolve) => setTimeout(resolve, 150))

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {
            ideal: facingMode,
          },
          width: {
            ideal: 1920,
          },
          height: {
            ideal: 1080,
          },
        },
      })

      streamRef.current = stream

      const video = videoRef.current

      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      video.pause()
      video.srcObject = null

      // Небольшая пауза перед новым srcObject
      await new Promise((resolve) => setTimeout(resolve, 50))

      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.autoplay = true

      await video.play()

      // Ждём реальные видеоданные
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve()
          return
        }

        const onLoaded = () => {
          video.removeEventListener('loadeddata', onLoaded)
          resolve()
        }

        video.addEventListener('loadeddata', onLoaded)

        setTimeout(() => {
          video.removeEventListener('loadeddata', onLoaded)
          resolve()
        }, 2000)
      })

      if (video.videoWidth === 0) {
        throw new Error('Camera stream has no video frames')
      }

      setReady(true)
    } catch (e) {
      console.error('Camera error:', e)

      stopStream()

      const err = e as DOMException

      if (
        err.name === 'NotAllowedError' ||
        err.name === 'SecurityError'
      ) {
        setError(
          'Нет доступа к камере. Разрешите доступ в настройках браузера.'
        )
      } else if (
        err.name === 'NotFoundError' ||
        err.name === 'OverconstrainedError'
      ) {
        setError('Подходящая камера не найдена на устройстве.')
      } else {
        setError(
          'Не удалось запустить камеру. Попробуйте ещё раз.'
        )
      }
    }
  }, [facingMode, stopStream])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await startCamera()
    }

    run()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [startCamera, stopStream])

  const toggleFacing = useCallback(() => {
    setReady(false)

    setFacingMode((current) =>
      current === 'environment' ? 'user' : 'environment'
    )
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
