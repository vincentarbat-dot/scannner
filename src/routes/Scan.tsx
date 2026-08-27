import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCamera } from '../hooks/useCamera'
import { useFrameAnalysis } from '../hooks/useFrameAnalysis'
import { ANALYSIS_WIDTH, analyzeFrame, pickHint, scorePage } from '../lib/imageQuality'
import { saveScannedDocument, type SaveProgress } from '../lib/uploadDocument'
import { enqueueScan } from '../lib/offlineQueue'
import CameraView from '../components/scan/CameraView'
import PageManager from '../components/scan/PageManager'
import ReviewChecklist from '../components/scan/ReviewChecklist'
import type { CapturedPage } from '../components/scan/types'

type Mode = 'camera' | 'manage' | 'review' | 'saving' | 'done' | 'queued' | 'error'

// Раздел 23 ТЗ: при нестабильном интернете сохраняем локально вместо
// показа ошибки. Отличаем "нет сети" от других ошибок (например, ошибка
// валидации/прав) по navigator.onLine и по типичным сигнатурам сетевых
// исключений fetch/Supabase.
function isLikelyNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed') ||
    message.includes('connection')
  )
}

// Тексты прогресса — раздел 22 ТЗ («максимально простой интерфейс»):
// пользователь должен понимать, что сейчас происходит, а не смотреть на
// голый спиннер во время обработки/загрузки в облако.
const STEP_LABELS: Record<SaveProgress['step'], string> = {
  creating: 'Создаём документ…',
  processing: 'Обрабатываем страницы…',
  codes: 'Проверяем QR-коды и штрихкоды…',
  uploading: 'Загружаем в облако…',
  pdf: 'Формируем PDF…',
  finalizing: 'Завершаем сохранение…',
}

const AUTO_CAPTURE_MS = 700 // сколько подряд держать «Документ обнаружен» перед авто-снимком
const AUTO_CAPTURE_COOLDOWN_MS = 1500 // пауза после снимка, чтобы не сдвоить кадр

export default function Scan() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('camera')
  const [pages, setPages] = useState<CapturedPage[]>([])
  const [retakeId, setRetakeId] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [progress, setProgress] = useState<SaveProgress | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedDocId, setSavedDocId] = useState<string | null>(null)

  const { videoRef, ready, error, facingMode, toggleFacing } = useCamera()
  const cameraActive = mode === 'camera' && !error
  const metrics = useFrameAnalysis(videoRef, cameraActive && ready)
  const hint = metrics ? pickHint(metrics) : null

  const streakStartRef = useRef<number | null>(null)
  const cooldownUntilRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const capture = useCallback(
    (auto: boolean) => {
      const video = videoRef.current
      if (!video || !video.videoWidth) return
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      canvas.toBlob(
        (blob) => {
          if (!blob) return
          const quality = metrics
            ? scorePage(metrics)
            : { score: 50, warnings: ['Не удалось оценить качество кадра'] }
          const page: CapturedPage = {
            id: crypto.randomUUID(),
            dataUrl,
            blob,
            score: quality.score,
            warnings: quality.warnings,
            auto,
            bounds: metrics?.bounds ?? null,
          }
          setFlash(true)
          window.setTimeout(() => setFlash(false), 150)
          setPages((prev) =>
            retakeId ? prev.map((p) => (p.id === retakeId ? page : p)) : [...prev, page]
          )
          if (retakeId) {
            // Раздел 26 ТЗ: аналитика считает пересъёмки. Событие без
            // document_id (документ ещё не создан) — фиксируем факт
            // пересъёмки на этапе съёмки, не блокируя UI ошибкой сети.
            supabase
              .from('document_events')
              .insert({ user_id: session?.user?.id ?? null, event_type: 'retake', meta: { auto } })
              .then(() => undefined)
            setRetakeId(null)
            setMode('manage')
          }
        },
        'image/jpeg',
        0.9
      )
    },
    [metrics, retakeId, videoRef, session]
  )

  // Автоматическое фотографирование — раздел 4 ТЗ: снимаем, когда
  // «Документ обнаружен» удерживается стабильно, с паузой между кадрами.
  useEffect(() => {
    if (mode !== 'camera' || !metrics) return
    const now = performance.now()
    if (hint?.kind === 'detected') {
      if (streakStartRef.current === null) streakStartRef.current = now
      if (
        streakStartRef.current !== null &&
        now - streakStartRef.current >= AUTO_CAPTURE_MS &&
        now >= cooldownUntilRef.current
      ) {
        streakStartRef.current = null
        cooldownUntilRef.current = now + AUTO_CAPTURE_COOLDOWN_MS
        capture(true)
      }
    } else {
      streakStartRef.current = null
    }
  }, [metrics, hint, mode, capture])

  const reorderPages = useCallback((from: number, to: number) => {
    setPages((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const deletePage = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const startRetake = useCallback((id: string) => {
    setRetakeId(id)
    setMode('camera')
  }, [])

  const startAddPage = useCallback(() => {
    setRetakeId(null)
    setMode('camera')
  }, [])

  // Резервный путь, если getUserMedia недоступен/отклонён — выбор файла
  // из галереи/через системную камеру устройства, чтобы флоу не упирался
  // в тупик на устройствах/браузерах без доступа к камере.
  const handleFileFallback = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return

      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('image load failed'))
        image.src = dataUrl
      })

      const w = ANALYSIS_WIDTH
      const h = Math.max(1, Math.round((img.height / img.width) * w))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const { quality, bounds } = (() => {
        if (!ctx) return { quality: { score: 50, warnings: ['Не удалось оценить качество файла'] }, bounds: null }
        ctx.drawImage(img, 0, 0, w, h)
        const { metrics: m } = analyzeFrame(ctx.getImageData(0, 0, w, h), null)
        return { quality: scorePage(m), bounds: m.bounds }
      })()

      const blob = file
      const page: CapturedPage = {
        id: crypto.randomUUID(),
        dataUrl,
        blob,
        score: quality.score,
        warnings: quality.warnings,
        auto: false,
        bounds,
      }
      setPages((prev) => (retakeId ? prev.map((p) => (p.id === retakeId ? page : p)) : [...prev, page]))
      setRetakeId(null)
      setMode('manage')
    },
    [retakeId]
  )

  const handleSave = useCallback(async () => {
    if (!session?.user?.id) {
      setSaveError('Не удалось определить пользователя — войдите заново.')
      setMode('error')
      return
    }
    setMode('saving')
    setSaveError(null)
    try {
      const { documentId } = await saveScannedDocument(pages, session.user.id, setProgress)
      setSavedDocId(documentId)
      setMode('done')
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        // Раздел 23 ТЗ: сохраняем локально и уходим на "готово" — фактическая
        // загрузка произойдёт автоматически при восстановлении сети
        // (OfflineSyncManager) либо вручную из панели очереди.
        await enqueueScan(pages, session.user.id)
        setMode('queued')
        return
      }
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить документ')
      setMode('error')
    }
  }, [pages, session])

  if (mode === 'manage') {
    return (
      <PageManager
        pages={pages}
        onReorder={reorderPages}
        onDelete={deletePage}
        onRetake={startRetake}
        onAddPage={startAddPage}
        onNext={() => setMode('review')}
        onCancel={() => navigate('/')}
      />
    )
  }

  if (mode === 'review') {
    return (
      <ReviewChecklist pages={pages} onRetake={() => setMode('manage')} onSaveAnyway={handleSave} />
    )
  }

  if (mode === 'saving') {
    const stepIndex = progress ? Object.keys(STEP_LABELS).indexOf(progress.step) : 0
    const totalSteps = Object.keys(STEP_LABELS).length
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="viewfinder-corners flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-2xl text-white">
          <span className="animate-pulse">⟳</span>
        </div>
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Сохраняем…</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          {progress ? STEP_LABELS[progress.step] : 'Готовим документ…'}
          {progress?.pageIndex !== undefined &&
            ` (стр. ${progress.pageIndex + 1}/${progress.pageCount})`}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${Math.round(((stepIndex + 1) / totalSteps) * 100)}%` }}
          />
        </div>
      </div>
    )
  }

  if (mode === 'error') {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="viewfinder-corners flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-danger)] text-3xl text-white">
          ⚠
        </div>
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Не удалось сохранить</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">{saveError}</p>
        <button
          type="button"
          onClick={handleSave}
          className="mt-2 w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)]"
        >
          Повторить
        </button>
        <button type="button" onClick={() => setMode('review')} className="text-sm text-[var(--color-ink-soft)]">
          Назад к проверке
        </button>
      </div>
    )
  }

  if (mode === 'queued') {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="viewfinder-corners flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-stamp)] text-3xl text-white">
          ⏳
        </div>
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Сохранено локально</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Не удалось подключиться к интернету. {pages.length} стр. сохранено на устройстве и
          автоматически загрузится, как только появится связь — статус можно посмотреть на
          главном экране.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-2 w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)]"
        >
          На главную
        </button>
      </div>
    )
  }

  if (mode === 'done') {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="viewfinder-corners flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-ok)] text-3xl text-white">
          ✓
        </div>
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Накладная сохранена</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          {pages.length} стр. обработано, загружено и собрано в PDF. Автоматическое распознавание
          полей (OCR) появится в Части 5 — сейчас поля заполняются вручную в карточке документа.
        </p>
        {savedDocId && (
          <button
            type="button"
            onClick={() => navigate(`/documents/${savedDocId}`)}
            className="mt-2 w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)]"
          >
            Открыть карточку документа
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-sm font-medium text-[var(--color-ink)]"
        >
          На главную
        </button>
      </div>
    )
  }

  // mode === 'camera'
  return (
    <div className="fixed inset-0 z-40 bg-black">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileFallback}
      />

      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-white">
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl bg-[var(--color-paper)] px-5 py-3 text-sm font-semibold text-[var(--color-ink)]"
          >
            Выбрать фото вручную
          </button>
          <button type="button" onClick={() => navigate('/')} className="text-sm text-white/70">
            Назад
          </button>
        </div>
      ) : (
        <CameraView
          videoRef={videoRef}
          hint={ready ? hint : null}
          bounds={ready ? metrics?.bounds ?? null : null}
          progress={`Страница ${pages.length + (retakeId ? 0 : 1)}${retakeId ? ' (пересъёмка)' : ''}`}
        >
          {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}

          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
            <button
              type="button"
              onClick={() => (pages.length > 0 ? setMode('manage') : navigate('/'))}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white"
              aria-label="Закрыть"
            >
              ✕
            </button>
            {pages.length > 0 && (
              <button
                type="button"
                onClick={() => setMode('manage')}
                className="rounded-full bg-black/45 px-4 py-2 text-sm font-medium text-white"
              >
                Готово ({pages.length})
              </button>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white"
              aria-label="Выбрать файл"
            >
              🖼
            </button>

            <button
              type="button"
              onClick={() => capture(false)}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-white/20 transition-transform active:scale-95"
              aria-label="Сделать снимок"
            >
              <span className="h-14 w-14 rounded-full bg-white" />
            </button>

            <button
              type="button"
              onClick={toggleFacing}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white"
              aria-label="Сменить камеру"
            >
              {facingMode === 'environment' ? '🤳' : '📷'}
            </button>
          </div>
        </CameraView>
      )}
    </div>
  )
}
