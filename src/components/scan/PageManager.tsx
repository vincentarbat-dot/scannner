import type { CapturedPage } from './types'

export default function PageManager({
  pages,
  onReorder,
  onDelete,
  onRetake,
  onAddPage,
  onNext,
  onCancel,
}: {
  pages: CapturedPage[]
  onReorder: (from: number, to: number) => void
  onDelete: (id: string) => void
  onRetake: (id: string) => void
  onAddPage: () => void
  onNext: () => void
  onCancel: () => void
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-5 pb-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-[var(--color-ink-soft)]"
        >
          Отмена
        </button>
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-soft)]">
          Страниц: {pages.length}
        </span>
      </div>

      <h1 className="font-display mt-2 text-2xl text-[var(--color-ink)]">Страницы накладной</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        Проверьте порядок страниц, при необходимости пересоснимите или удалите.
      </p>

      <ul className="mt-5 flex-1 space-y-3 overflow-y-auto">
        {pages.map((page, i) => (
          <li
            key={page.id}
            className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-3"
          >
            <div className="relative shrink-0 overflow-hidden rounded-lg border border-[var(--color-line)]">
              <img src={page.dataUrl} alt={`Страница ${i + 1}`} className="h-20 w-16 object-cover" />
              <span className="font-mono-data absolute bottom-0 left-0 right-0 bg-black/55 py-0.5 text-center text-[10px] text-white">
                {i + 1}/{pages.length}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  page.score < 60 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
                }`}
              >
                Качество: {page.score}%
              </p>
              {page.warnings.length > 0 ? (
                <p className="mt-0.5 truncate text-xs text-[var(--color-ink-soft)]">
                  {page.warnings[0]}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">Замечаний нет</p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <button
                  type="button"
                  onClick={() => onReorder(i, i - 1)}
                  disabled={i === 0}
                  className="font-medium text-[var(--color-accent)] disabled:opacity-30"
                >
                  ↑ Вверх
                </button>
                <button
                  type="button"
                  onClick={() => onReorder(i, i + 1)}
                  disabled={i === pages.length - 1}
                  className="font-medium text-[var(--color-accent)] disabled:opacity-30"
                >
                  ↓ Вниз
                </button>
                <button
                  type="button"
                  onClick={() => onRetake(page.id)}
                  className="font-medium text-[var(--color-accent)]"
                >
                  Переснять
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(page.id)}
                  className="font-medium text-[var(--color-danger)]"
                >
                  Удалить
                </button>
              </div>
            </div>
          </li>
        ))}

        {pages.length === 0 && (
          <li className="rounded-2xl border border-dashed border-[var(--color-line)] p-6 text-center text-sm text-[var(--color-ink-soft)]">
            Пока нет ни одной страницы.
          </li>
        )}
      </ul>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={onAddPage}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-sm font-medium text-[var(--color-ink)] transition-colors active:bg-[var(--color-stamp-soft)]"
        >
          + Добавить страницу
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={pages.length === 0}
          className="w-full rounded-xl bg-[var(--color-ink)] py-3 text-sm font-semibold text-[var(--color-paper)] transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          Далее
        </button>
      </div>
    </div>
  )
}
