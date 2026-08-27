export type UserRole = 'employee' | 'accountant' | 'admin'

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
  created_at: string
}

export type DocumentStatus =
  | 'new'
  | 'reviewed'
  | 'sent_to_accounting'
  | 'processed'
  | 'archived'

export type UploadStatus = 'pending_upload' | 'uploading' | 'uploaded' | 'upload_error'

export interface RecognizedItem {
  name: string
  article?: string
  quantity?: number
  unit?: string
  price?: number
  amount?: number
}

export interface InvoiceDocument {
  id: string
  created_by: string | null
  supplier_id: string | null
  supplier_name: string | null
  supplier_bin: string | null
  supplier_iin: string | null
  document_number: string | null
  invoice_number: string | null
  invoice_date: string | null
  total_amount: number | null
  vat_amount: number | null
  bank_details: Record<string, unknown> | null
  recognized_items: RecognizedItem[] | null
  ocr_result: Record<string, unknown> | null
  ocr_completed_at: string | null
  status: DocumentStatus
  page_count: number
  quality_score: number | null
  has_qr: boolean
  has_barcode: boolean
  pdf_path: string | null
  upload_status: UploadStatus
  created_at: string
  updated_at: string
}

export interface DocumentPage {
  id: string
  document_id: string
  page_number: number
  original_path: string
  processed_path: string | null
  quality_score: number | null
  is_blurry: boolean
  has_glare: boolean
  qr_readable: boolean | null
  barcode_readable: boolean | null
  created_at: string
}

export type CodeType = 'qr' | 'barcode' | 'datamatrix'

export interface DocumentCode {
  id: string
  document_id: string
  page_id: string | null
  code_type: CodeType
  raw_value: string | null
  is_readable: boolean
  created_at: string
}

export const CODE_TYPE_LABELS: Record<CodeType, string> = {
  qr: 'QR-код',
  barcode: 'Штрихкод',
  datamatrix: 'Data Matrix',
}

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  new: 'Новый',
  reviewed: 'Проверен',
  sent_to_accounting: 'Передан бухгалтерии',
  processed: 'Обработан',
  archived: 'Архив',
}
