// Раздел 23 ТЗ: "после восстановления соединения документ должен
// автоматически отправляться на сервер". Компонент без UI, монтируется
// один раз в App.tsx внутри Layout — слушает событие 'online' и пытается
// разобрать очередь; плюс пробует один раз при монтировании (на случай,
// если сеть уже была и вкладка просто открылась заново).

import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { processQueue } from '../lib/offlineQueue'

export default function OfflineSyncManager() {
  const { session } = useAuth()
  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) return

    if (navigator.onLine) processQueue(userId)

    const handleOnline = () => processQueue(userId)
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [userId])

  return null
}
