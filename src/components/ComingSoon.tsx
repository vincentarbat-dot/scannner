export default function ComingSoon({
  title,
  part,
  description,
}: {
  title: string
  part: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-stamp)]">
        {part}
      </span>
      <h1 className="font-display mt-1 text-2xl text-[var(--color-ink)]">{title}</h1>
      <div className="viewfinder-corners mt-6 rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper-raised)] p-6 text-[var(--color-accent)]">
        <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{description}</p>
      </div>
    </div>
  )
}
