export default function SetupNotice() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-paper)] p-6 text-center">
      <div className="viewfinder-corners rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-6 text-[var(--color-accent)]">
        <h1 className="font-display text-xl text-[var(--color-ink)]">Нужна настройка Supabase</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Скопируйте <code className="font-mono-data">.env.example</code> в{' '}
          <code className="font-mono-data">.env</code>, вставьте <code className="font-mono-data">VITE_SUPABASE_URL</code> и{' '}
          <code className="font-mono-data">VITE_SUPABASE_ANON_KEY</code> из панели Supabase (Project Settings → API),
          затем перезапустите сборку. Подробности — в README.md и PROGRESS.md.
        </p>
      </div>
    </div>
  )
}
