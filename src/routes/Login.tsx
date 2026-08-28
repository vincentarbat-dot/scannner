import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, signInWithPassword, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signedUpNotice, setSignedUpNotice] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const result =
      mode === 'signin'
        ? await signInWithPassword(email, password)
        : await signUp(email, password, fullName)
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    } else if (mode === 'signup') {
      setSignedUpNotice(true)
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-2xl text-[var(--color-ink)]">
          {mode === 'signin' ? 'Вход' : 'Регистрация'}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">Сканер накладных поставщиков</p>

        {signedUpNotice ? (
          <p className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4 text-sm text-[var(--color-ink)]">
            Проверьте почту {email} — там ссылка для подтверждения аккаунта.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            {mode === 'signup' && (
              <Field label="Имя">
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                  placeholder="Иван Иванов"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@company.kz"
              />
            </Field>
            <Field label="Пароль">
              <input
                required
                minLength={6}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </Field>

            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[var(--color-ink)] py-3.5 text-sm font-medium text-[var(--color-paper)] transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        )}

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setSignedUpNotice(false)
          }}
          className="mt-5 w-full text-center text-sm text-[var(--color-accent)]"
        >
          {mode === 'signin' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-ink-soft)]">{label}</span>
      {children}
    </label>
  )
}
