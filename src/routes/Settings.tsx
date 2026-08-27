import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { session, profile, signOut } = useAuth()

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-8">
      <h1 className="font-display text-2xl text-[var(--color-ink)]">Настройки</h1>

      <div className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4">
        <p className="text-sm text-[var(--color-ink-soft)]">Аккаунт</p>
        <p className="mt-1 text-base text-[var(--color-ink)]">{profile?.full_name || '—'}</p>
        <p className="text-sm text-[var(--color-ink-soft)]">{session?.user.email}</p>
        <p className="mt-2 inline-block rounded-full bg-[var(--color-stamp-soft)] px-2.5 py-0.5 text-xs text-[var(--color-stamp)]">
          Роль: {profile?.role || 'employee'}
        </p>
      </div>

      {profile?.role === 'admin' && (
        <Link
          to="/admin"
          className="mt-4 block w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-center text-sm font-medium text-[var(--color-accent)]"
        >
          Панель администратора
        </Link>
      )}

      <button
        onClick={() => signOut()}
        className="mt-6 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] py-3 text-sm font-medium text-[var(--color-danger)] transition-transform active:scale-[0.98]"
      >
        Выйти из аккаунта
      </button>

      <p className="mt-8 text-center text-xs text-[var(--color-ink-soft)]">
        Сканер накладных · MVP, Часть 4
      </p>
    </div>
  )
}
