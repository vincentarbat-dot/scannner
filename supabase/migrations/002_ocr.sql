-- Part 5: client-side PaddleOCR result storage. Existing document fields remain
-- the canonical editable values; this column keeps the immutable OCR evidence.
alter table public.documents
  add column if not exists supplier_iin text,
  add column if not exists document_number text,
  add column if not exists ocr_result jsonb,
  add column if not exists ocr_completed_at timestamptz;

create index if not exists documents_ocr_completed_idx
  on public.documents(ocr_completed_at desc);
