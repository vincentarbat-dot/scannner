import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabaseConfigured } from '../lib/supabase'
import SetupNotice from './SetupNotice'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (!supabaseConfigured) return <SetupNotice />

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--color-ink-soft)]">
        Загрузка…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
