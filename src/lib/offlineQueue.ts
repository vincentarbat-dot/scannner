// Офлайн-очередь — раздел 23 ТЗ ("работа при плохом интернете").
//
// Если сохранение накладной (saveScannedDocument, см. uploadDocument.ts)
// не удаётся из-за отсутствия сети, отснятые страницы кладутся в
// IndexedDB (через `idb`) вместо того, чтобы просто показать ошибку.
// Очередь обрабатывается автоматически при восстановлении соединения
// (см. OfflineSyncManager.tsx) либо вручную кнопкой «Повторить».
//
// Статусы ровно те, что требует ТЗ: "Ожидает загрузки" / "Загрузка" /
// "Загружено" / "Ошибка загрузки" — см. QUEUE_STATUS_LABELS в
// OfflineQueuePanel.tsx.

import { openDB, type IDBPDatabase } from 'idb'
import { saveScannedDocument, SaveDocumentError } from './uploadDocument'
import type { CapturedPage } from '../components/scan/types'

export type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'error'

export interface QueueItem {
  id: string
  userId: string
  pages: CapturedPage[]
  status: QueueStatus
  error: string | null
  createdAt: number
  documentId?: string
  /** Баг-фикс: id документа-черновика, уже созданного при неудачной
   *  попытке — переиспользуется при повторе (см. SaveDocumentError в
   *  uploadDocument.ts), чтобы retry не плодил дубликаты накладных. */
  draftDocumentId?: string
}

const DB_NAME = 'invoice-scanner-offline'
const STORE = 'pending_scans'
const EVENT_NAME = 'offline-queue-updated'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

function notifyChanged() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function onQueueChanged(listener: () => void): () => void {
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}

export async function enqueueScan(pages: CapturedPage[], userId: string, draftDocumentId?: string): Promise<QueueItem> {
  const db = await getDb()
  const item: QueueItem = {
    id: crypto.randomUUID(),
    userId,
    pages,
    status: 'pending',
    error: null,
    createdAt: Date.now(),
    draftDocumentId,
  }
  await db.put(STORE, item)
  notifyChanged()
  return item
}

export async function listQueue(userId?: string): Promise<QueueItem[]> {
  const db = await getDb()
  const all = (await db.getAll(STORE)) as QueueItem[]
  const filtered = userId ? all.filter((i) => i.userId === userId) : all
  return filtered.sort((a, b) => b.createdAt - a.createdAt)
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, id)
  notifyChanged()
}

async function updateItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  const db = await getDb()
  const existing = (await db.get(STORE, id)) as QueueItem | undefined
  if (!existing) return
  await db.put(STORE, { ...existing, ...patch })
  notifyChanged()
}

let processing = false

/** Пытается загрузить все документы из очереди по порядку. Безопасно вызывать
 *  повторно (например, и на 'online', и по таймеру) — защищено флагом `processing`. */
export async function processQueue(userId: string): Promise<void> {
  if (processing) return
  processing = true
  try {
    const items = await listQueue(userId)
    for (const item of items) {
      if (item.status === 'uploaded') continue
      if (!navigator.onLine) break
      await updateItem(item.id, { status: 'uploading', error: null })
      try {
        const { documentId } = await saveScannedDocument(item.pages, userId, undefined, item.draftDocumentId)
        await updateItem(item.id, { status: 'uploaded', documentId })
      } catch (err) {
        // Баг-фикс: сохраняем draftDocumentId из исключения, чтобы
        // СЛЕДУЮЩИЙ повтор переиспользовал этот же документ, а не создал
        // ещё один — см. SaveDocumentError в uploadDocument.ts.
        const draftDocumentId = err instanceof SaveDocumentError ? err.documentId : item.draftDocumentId
        await updateItem(item.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Не удалось загрузить документ',
          draftDocumentId,
        })
      }
    }
  } finally {
    processing = false
  }
}

export async function retryQueueItem(id: string, userId: string): Promise<void> {
  await updateItem(id, { status: 'pending', error: null })
  await processQueue(userId)
}
