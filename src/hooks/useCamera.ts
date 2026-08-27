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

/**
 * Камера через getUserMedia.
 *
 * Некоторые мобильные браузеры принимают слишком агрессивные constraints
 * (особенно 4096x2160 + facingMode) и возвращают поток, у которого video
 * остаётся чёрным. Поэтому запускаем камеру каскадом: сначала просим
 * подходящую камеру и высокое разрешение, затем постепенно упрощаем
 * constraints.
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startIdRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] =
    useState<'environment' | 'user'>('environment')

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const video = videoRef.current

    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const startId = ++startIdRef.current

    setReady(false)
    setError(null)

    async function waitForVideo(
      video: HTMLVideoElement,
      stream: MediaStream,
    ): Promise<void> {
      video.srcObject = stream
      video.muted = true
      video.autoplay = true
      video.playsInline = true

      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve) => {
          const onLoaded = () => {
            video.removeEventListener('loadedmetadata', onLoaded)
            resolve()
          }

          video.addEventListener('loadedmetadata', onLoaded, {
            once: true,
          })

          window.setTimeout(() => {
            video.removeEventListener('loadedmetadata', onLoaded)
            resolve()
          }, 2000)
        })
      }

      try {
        await video.play()
      } catch {
        // muted + playsInline обычно позволяют autoplay.
      }

      // Даём камере время начать отдавать реальные кадры.
      const deadline = performance.now() + 2500

      const probe = document.createElement('canvas')
      probe.width = 16
      probe.height = 12

      const probeContext = probe.getContext('2d', {
        willReadFrequently: true,
      })

      while (!cancelled && performance.now() < deadline) {
        if (
          video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          if (probeContext) {
            probeContext.drawImage(
              video,
              0,
              0,
              probe.width,
              probe.height,
            )

            const pixels = probeContext.getImageData(
              0,
              0,
              probe.width,
              probe.height,
            ).data

            let nonBlack = 0

            for (let i = 0; i < pixels.length; i += 4) {
              if (
                pixels[i] > 8 ||
                pixels[i + 1] > 8 ||
                pixels[i + 2] > 8
              ) {
                nonBlack++
              }
            }

            if (nonBlack > 2) {
              return
            }
          } else {
            return
          }
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, 100),
        )
      }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new DOMException(
          'Camera produced no video frames',
          'NotReadableError',
        )
      }

      // Камера вернула поток, но фактически отдаёт чёрное изображение.
      throw new DOMException(
        'Camera produced black video frames',
        'NotReadableError',
      )
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Камера недоступна в этом браузере.')
        return
      }

      stopStream()

      /*
       * Используем каскад constraints.
       *
       * 1. Задняя/передняя камера + высокое разрешение.
       * 2. Full HD.
       * 3. Только facingMode.
       * 4. Любая доступная камера.
       *
       * Это важно для устройств, где запрос 4K вызывает
       * чёрный video stream.
       */
      const constraints: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            facingMode: {
              exact: facingMode,
            },
            width: {
              ideal: 4096,
            },
            height: {
              ideal: 2160,
            },
          },
        },

        {
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
        },

        {
          audio: false,
          video: {
            facingMode: {
              ideal: facingMode,
            },
          },
        },

        {
          audio: false,
          video: true,
        },
      ]

      let lastError: unknown = null

      for (const mediaConstraints of constraints) {
        if (
          cancelled ||
          startId !== startIdRef.current
        ) {
          return
        }

        let stream: MediaStream | null = null

        try {
          stream = await navigator.mediaDevices.getUserMedia(
            mediaConstraints,
          )

          if (
            cancelled ||
            startId !== startIdRef.current
          ) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }

          streamRef.current = stream

          const video = videoRef.current

          if (!video) {
            throw new DOMException(
              'Video element is unavailable',
              'AbortError',
            )
          }

          await waitForVideo(video, stream)

          if (
            cancelled ||
            startId !== startIdRef.current
          ) {
            return
          }

          setReady(true)

          return
        } catch (e) {
          lastError = e

          stream?.getTracks().forEach((track) => track.stop())

          streamRef.current = null

          if (videoRef.current) {
            videoRef.current.srcObject = null
          }
        }
      }

      if (
        cancelled ||
        startId !== startIdRef.current
      ) {
        return
      }

      const err = lastError as DOMException | undefined

      if (
        err?.name === 'NotAllowedError' ||
        err?.name === 'SecurityError'
      ) {
        setError(
          'Нет доступа к камере. Разрешите доступ в настройках браузера.',
        )
      } else if (err?.name === 'NotFoundError') {
        setError('Камера не найдена на устройстве.')
      } else if (err?.name === 'NotReadableError') {
        setError(
          'Камера найдена, но браузер не получает изображение. Закройте другие приложения, использующие камеру, и попробуйте ещё раз.',
        )
      } else {
        setError(
          'Не удалось запустить камеру. Попробуйте ещё раз.',
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [facingMode, stopStream])

  const toggleFacing = useCallback(() => {
    setFacingMode((mode) =>
      mode === 'environment'
        ? 'user'
        : 'environment',
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
