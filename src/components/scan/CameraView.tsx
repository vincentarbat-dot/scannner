import type { ReactNode, RefObject } from 'react'
import type { DocumentBounds, HintResult } from '../../lib/imageQuality'

const HINT_STYLES: Record<HintResult['kind'], string> = {
  detected: 'bg-[var(--color-ok)] text-white',
  frame: 'bg-black/55 text-white',
  dark: 'bg-[var(--color-stamp)] text-white',
  glare: 'bg-[var(--color-stamp)] text-white',
  blur: 'bg-[var(--color-stamp)] text-white',
}

const BOX_COLOR: Record<HintResult['kind'], string> = {
  detected: 'var(--color-ok)',
  frame: 'rgba(255,255,255,0.85)',
  dark: 'var(--color-stamp)',
  glare: 'var(--color-stamp)',
  blur: 'var(--color-stamp)',
}

export default function CameraView({
  videoRef,
  hint,
  bounds,
  progress,
  children,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  hint: HintResult | null
  bounds: DocumentBounds | null
  progress?: string
  children?: ReactNode
}) {
  const color = hint ? BOX_COLOR[hint.kind] : 'rgba(255,255,255,0.7)'

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />

      {/* Статическая направляющая — куда стоит поместить документ, пока
          он не найден автоматически */}
      {!bounds && (
        <div
          className="viewfinder-corners pointer-events-none absolute left-[10%] top-[18%] h-[64%] w-[80%] rounded-2xl border-2 border-dashed opacity-70"
          style={{ borderColor: color }}
        />
      )}

      {/* Обнаруженные границы документа */}
      {bounds && (
        <div
          className="pointer-events-none absolute rounded-xl border-[3px] transition-[left,top,width,height,border-color] duration-150 ease-out"
          style={{
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
            borderColor: color,
          }}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-[env(safe-area-inset-top)] flex flex-col items-center gap-2 px-4 pt-4">
        {progress && (
          <span className="font-mono-data rounded-full bg-black/50 px-3 py-1 text-xs text-white">
            {progress}
          </span>
        )}
        <span
          className={`rounded-full px-4 py-2 text-center text-sm font-medium shadow-lg transition-colors ${
            hint ? HINT_STYLES[hint.kind] : 'bg-black/50 text-white'
          }`}
        >
          {hint ? hint.message : 'Наведите камеру на накладную…'}
        </span>
      </div>

      {children}
    </div>
  )
}
