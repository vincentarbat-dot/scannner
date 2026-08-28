import type { CapturedPage } from './types'

const QUALITY_OK_THRESHOLD = 70

interface ChecklistItem {
  label: string
  ok: boolean
}

// Чек-лист на этом этапе — эвристика по метрикам съёмки (резкость, свет,
// блики, рамка). Проверка QR/штрихкода/печати и полноценный OCR — Часть 3
// (раздел 8–10, 13 ТЗ); здесь для них пока нет данных.
function buildChecklist(pages: CapturedPage[]): ChecklistItem[] {
  const allWarnings = pages.flatMap((p) => p.warnings)
  return [
    { label: 'Документ читаемый', ok: !allWarnings.some((w) => w.includes('смазано')) },
    { label: 'Освещение в норме', ok: !allWarnings.some((w) => w.includes('освещения') || w.includes('яркое')) },
    { label: 'Без сильных бликов', ok: !allWarnings.some((w) => w.includes('блик')) },
    {
      label: 'Документ полностью в кадре',
      ok: !allWarnings.some(
        (w) => w.includes('обрезан') || w.includes('малую часть') || w.includes('не определены')
      ),
    },
    { label: 'Все страницы отсняты', ok: pages.length > 0 },
  ]
}

export default function ReviewChecklist({
  pages,
  onRetake,
  onSaveAnyway,
}: {
  pages: CapturedPage[]
  onRetake: () => void
  onSaveAnyway: () => void
}) {
  const overallScore =
    pages.length === 0 ? 0 : Math.round(pages.reduce((sum, p) => sum + p.score, 0) / pages.length)
  const checklist = buildChecklist(pages)
  const isGood = overallScore >= QUALITY_OK_THRESHOLD

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-5 pb-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-stamp)]">
        Проверка перед сохранением
      </span>
      <h1 className="font-display mt-1 text-2xl text-[var(--color-ink)]">
        Качество документа: {overallScore}%
      </h1>

      {!isGood && (
        <p className="mt-2 rounded-xl bg-[var(--color-stamp-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
          Документ может быть плохо читаемым. Рекомендуется переснять.
        </p>
      )}

      <ul className="mt-5 space-y-2">
        {checklist.map((item) => (
          <li
            key={item.label}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-4 py-3"
          >
            <span
              className={`text-lg leading-none ${
                item.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'
              }`}
              aria-hidden
            >
              {item.ok ? '✓' : '⚠'}
            </span>
            <span className="text-sm text-[var(--color-ink)]">{item.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
        {pages.map((page, i) => (
          <img
            key={page.id}
            src={page.dataUrl}
            alt={`Страница ${i + 1}`}
            className="h-24 w-[4.5rem] shrink-0 rounded-lg border border-[var(--color-line)] object-cover"
          />
        ))}
      </div>

      <div className="mt-auto space-y-2 pt-6">
        <button
          type="button"
          onClick={onRetake}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-sm font-medium text-[var(--color-ink)]"
        >
          Переснять
        </button>
        <button
          type="button"
          onClick={onSaveAnyway}
          className="w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)] transition-transform active:scale-[0.98]"
        >
          {isGood ? 'Сохранить' : 'Сохранить всё равно'}
        </button>
      </div>
    </div>
  )
}
