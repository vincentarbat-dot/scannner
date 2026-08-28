import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import OfflineQueuePanel from '../components/OfflineQueuePanel'

export default function Home() {
  const { profile } = useAuth()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <p className="text-sm text-[var(--color-ink-soft)]">
        {greeting}{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
      </p>
      <h1 className="font-display mt-1 text-[28px] leading-tight text-[var(--color-ink)]">
        Накладные под контролем
      </h1>

      <div className="mt-5">
        <OfflineQueuePanel />
      </div>

      {/* Hero: главное действие — сканировать, оформлено как видоискатель камеры */}
      <Link
        to="/scan"
        className="viewfinder-corners mt-6 block rounded-2xl bg-[var(--color-ink)] p-6 text-[var(--color-paper)] shadow-lg shadow-black/10 transition-transform active:scale-[0.98]"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs uppercase tracking-widest text-[var(--color-paper)]/60">
              Основной сценарий
            </span>
            <p className="font-display mt-1 text-2xl">Сканировать накладную</p>
            <p className="mt-1 text-sm text-[var(--color-paper)]/70">
              Камера сама найдёт границы, проверит QR и печать
            </p>
          </div>
          <CameraGlyph />
        </div>
      </Link>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <QuickCard to="/archive" title="Архив" subtitle="Все документы" icon={<ArchiveGlyph />} />
        <QuickCard to="/search" title="Поиск" subtitle="По поставщику, сумме" icon={<SearchGlyph />} />
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-soft)]">
          Что защищает система при сканировании
        </h2>
        <ol className="mt-3 space-y-2">
          {PRIORITY.map((item, i) => (
            <li
              key={item}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-4 py-3"
            >
              <span className="font-mono-data text-xs text-[var(--color-stamp)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-sm text-[var(--color-ink)]">{item}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

const PRIORITY = [
  'Текст документа',
  'QR-код',
  'Штрихкод',
  'Печать',
  'Подпись',
  'Банковские реквизиты',
  'Общее качество скана',
]

function QuickCard({ to, title, subtitle, icon }: { to: string; title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4 transition-colors active:bg-[var(--color-stamp-soft)]"
    >
      <div className="text-[var(--color-accent)]">{icon}</div>
      <p className="font-display mt-2 text-base text-[var(--color-ink)]">{title}</p>
      <p className="text-xs text-[var(--color-ink-soft)]">{subtitle}</p>
    </Link>
  )
}

function CameraGlyph() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 opacity-90">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.5h7L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  )
}
function ArchiveGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="4" width="17" height="5" rx="1" />
      <path d="M5 9v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" strokeLinecap="round" />
    </svg>
  )
}
function SearchGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}
