// Общие типы для OCR-модуля (Часть 5, раздел 13 ТЗ).

export interface OcrTextLine {
  text: string
  confidence: number | null
  // Координаты строки в пикселях исходного изображения (bbox), если
  // движок их отдаёт — используются для сортировки строк сверху вниз и
  // слева направо (reading order) и для эвристики "это строка таблицы
  // товаров" в parseInvoiceFields.ts.
  x: number
  y: number
  width: number
  height: number
}

export interface OcrPageResult {
  pageIndex: number
  lines: OcrTextLine[]
  rawText: string
}

export interface OcrFields {
  supplier_name: string | null
  supplier_bin: string | null
  invoice_number: string | null
  invoice_date: string | null // YYYY-MM-DD — формат <input type="date">
  total_amount: number | null
  vat_amount: number | null
  bank_details: string | null
}

export interface RecognizedOcrItem {
  name: string
  quantity?: number
  unit?: string
  price?: number
  amount?: number
}

export interface OcrDocumentResult {
  pages: OcrPageResult[]
  fields: OcrFields
  items: RecognizedOcrItem[]
  // Заполняется, если движок вообще не смог отработать хотя бы на одной
  // странице (модель не загрузилась, WASM недоступен и т.п.). UI обязан
  // явно показать это пользователю — иначе выглядит так, будто OCR
  // "ничего не нашёл" на читаемой накладной, а на деле он просто не
  // запустился.
  engineError: string | null
}
