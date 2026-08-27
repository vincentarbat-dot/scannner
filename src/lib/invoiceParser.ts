import type { OcrItem } from './ocr'
import type { RecognizedItem } from '../types'

export interface ParsedField<T = string> {
  value: T
  confidence: number
  source: string[]
  needsReview: boolean
}

export interface ParsedInvoice {
  supplier_name: ParsedField
  supplier_bin: ParsedField
  supplier_iin: ParsedField
  invoice_number: ParsedField
  invoice_date: ParsedField
  document_number: ParsedField
  bank_details: ParsedField<Record<string, string>>
  total_amount: ParsedField<number>
  vat_amount: ParsedField<number>
  items: Array<RecognizedItem & { confidence?: number; needsReview?: boolean; source?: string[] }>
  rawText: string
}

const REVIEW_SCORE = 0.75
const money = /(?:\d{1,3}(?:[\s.,]\d{3})*|\d+)(?:[.,]\d{1,2})?/g
const bin = /\b\d{12}\b/g
const iin = /\b\d{12}\b/g
const date = /\b(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/g

interface Boxed {
  item: OcrItem
  text: string
  score: number
  x: number
  y: number
  w: number
  h: number
}

function box(item: OcrItem): Boxed {
  const xs = item.poly.map((p) => p[0] ?? 0)
  const ys = item.poly.map((p) => p[1] ?? 0)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { item, text: item.text.trim(), score: item.score, x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function normalizeText(value: string): string {
  return value.replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim()
}

function avgScore(items: Boxed[]): number {
  if (!items.length) return 0
  return items.reduce((sum, item) => sum + item.score, 0) / items.length
}

function cleanNumber(value: string): number | undefined {
  const s = value.replace(/\s/g, '').replace(/₸/g, '').trim()
  if (!s) return undefined
  const normalized = s.includes(',') && s.includes('.')
    ? s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
    : s.replace(',', '.')
  const n = Number(normalized.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function field(value: string, confidence: number, source: string[] = []): ParsedField {
  return { value: normalizeText(value), confidence, source, needsReview: confidence < REVIEW_SCORE }
}

function numberField(value: number | undefined, confidence: number, source: string[] = []): ParsedField<number> {
  return { value: value ?? 0, confidence, source, needsReview: value == null || confidence < REVIEW_SCORE }
}

function findLabeled(lines: Boxed[], labels: RegExp): { value: string; confidence: number; source: string[] } | null {
  for (let i = 0; i < lines.length; i++) {
    if (!labels.test(lines[i].text)) continue
    const sameLine = lines.filter((x) => Math.abs(x.y - lines[i].y) <= Math.max(lines[i].h, x.h) * 0.65 && x.x > lines[i].x)
      .sort((a, b) => a.x - b.x)
    const direct = sameLine.find((x) => x.text !== lines[i].text)
    if (direct) return { value: direct.text, confidence: Math.min(lines[i].score, direct.score), source: [lines[i].text, direct.text] }
    const next = lines[i + 1]
    if (next && next.y > lines[i].y && next.y - lines[i].y < Math.max(100, lines[i].h * 4)) {
      return { value: next.text, confidence: Math.min(lines[i].score, next.score), source: [lines[i].text, next.text] }
    }
  }
  return null
}

function extractIdentifier(lines: Boxed[], labels: RegExp, pattern: RegExp): ParsedField {
  const labeled = findLabeled(lines, labels)
  const candidates = (labeled ? [labeled.value] : []).concat(lines.map((x) => x.text))
  for (const text of candidates) {
    const match = text.replace(/\s/g, '').match(pattern)
    if (match) {
      const source = labeled?.source ?? [text]
      return field(match[0], labeled?.confidence ?? 0.8, source)
    }
  }
  return field('', 0, [])
}

function parseDate(lines: Boxed[]): ParsedField {
  const labeled = findLabeled(lines, /(?:дата|date)/i)
  const candidates = (labeled ? [labeled.value] : []).concat(lines.map((x) => x.text))
  for (const text of candidates) {
    const match = text.match(date)?.[0]
    if (match) {
      const parts = match.split(/[./-]/).map(Number)
      const iso = parts[0] > 31 ? `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}` : `${parts[2] < 100 ? 2000 + parts[2] : parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`
      return field(iso, labeled?.confidence ?? 0.8, labeled?.source ?? [match])
    }
  }
  return field('', 0, [])
}

function parseSupplier(lines: Boxed[]): ParsedField {
  const labeled = findLabeled(lines, /(?:поставщик|поставила|продавец|организац|наименование\s+организац)/i)
  if (labeled) return field(labeled.value, labeled.confidence, labeled.source)
  const candidate = lines.find((x) => /(?:ТОО|АО|ИП|ТОО\.?|ООО)\b/i.test(x.text))
  return candidate ? field(candidate.text, candidate.score, [candidate.text]) : field('', 0, [])
}

function parseTotals(lines: Boxed[]): { total: ParsedField<number>; vat: ParsedField<number> } {
  const totalCandidates = lines.filter((x) => /(?:итого|всего|к\s*оплате|сумма\s+итого|total)/i.test(x.text))
  const vatCandidates = lines.filter((x) => /(?:ндс|налог\s+на\s+добавленную\s+стоимость|vat)/i.test(x.text))
  const parse = (candidates: Boxed[], fallbackIndex: number): ParsedField<number> => {
    for (const c of candidates) {
      const nums = c.text.match(money)?.map(cleanNumber).filter((n): n is number => n != null) ?? []
      if (nums.length) return numberField(nums[nums.length - 1], c.score, [c.text])
      const nearby = lines.filter((x) => Math.abs(x.y - c.y) <= Math.max(c.h, x.h) && x.x > c.x)
      const n = nearby.flatMap((x) => x.text.match(money)?.map(cleanNumber) ?? []).filter((x): x is number => x != null)
      if (n.length) return numberField(n[n.length - 1], Math.min(c.score, avgScore(nearby)), [c.text, ...nearby.map((x) => x.text)])
    }
    const nums = lines.flatMap((x) => x.text.match(money)?.map(cleanNumber) ?? []).filter((n): n is number => n != null)
    return numberField(nums[nums.length - fallbackIndex], 0.45, nums.length ? [String(nums[nums.length - fallbackIndex])] : [])
  }
  return { total: parse(totalCandidates, 1), vat: parse(vatCandidates, 2) }
}

function groupRows(items: Boxed[]): Boxed[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Boxed[][] = []
  for (const item of sorted) {
    const row = rows.find((r) => {
      const center = r.reduce((s, x) => s + x.y + x.h / 2, 0) / r.length
      const tolerance = Math.max(item.h, r.reduce((s, x) => s + x.h, 0) / r.length) * 0.7
      return Math.abs(item.y + item.h / 2 - center) <= tolerance
    })
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x)).sort((a, b) => a[0].y - b[0].y)
}

function parseTable(items: Boxed[]): ParsedInvoice['items'] {
  const rows = groupRows(items)
  const headerIndex = rows.findIndex((row) => /(?:наименование|товар|услуг|артикул|кол-?во|количество|цена|сумма)/i.test(row.map((x) => x.text).join(' ')))
  if (headerIndex < 0) return []

  const header = rows[headerIndex]
  const headers = header.map((x) => ({ text: x.text.toLowerCase(), x: x.x }))
  const column = (patterns: RegExp[]): number | undefined => {
    const h = headers.find((x) => patterns.some((p) => p.test(x.text)))
    return h?.x
  }
  const nameX = column([/наимен/, /товар/, /услуг/]) ?? header[0]?.x ?? 0
  const articleX = column([/артик/, /код/, /sku/])
  const quantityX = column([/кол/, /кол-?во/])
  const unitX = column([/ед\.?\s*изм/, /единиц/])
  const priceX = column([/цена/, /стоимость\s*ед/])
  const amountX = column([/сумма/, /итого/, /стоимость/])

  const pick = (row: Boxed[], x: number | undefined, fallback: number): Boxed | undefined => {
    if (x == null) return undefined
    return row.reduce((best, candidate) => Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best, row[fallback])
  }

  const out: ParsedInvoice['items'] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const text = row.map((x) => x.text).join(' ')
    if (/(?:итого|всего|ндс|к\s*оплате|подпись|руководитель|директор)/i.test(text)) continue
    const name = pick(row, nameX, 0)
    if (!name || !name.text || /^\d+[.)]?$/.test(name.text)) continue
    const quantity = cleanNumber(pick(row, quantityX, Math.max(0, row.length - 3))?.text ?? '')
    const price = cleanNumber(pick(row, priceX, Math.max(0, row.length - 2))?.text ?? '')
    const amount = cleanNumber(pick(row, amountX, Math.max(0, row.length - 1))?.text ?? '')
    const article = pick(row, articleX, 1)?.text
    const unit = pick(row, unitX, 2)?.text
    const confidence = avgScore(row)
    out.push({ name: normalizeText(name.text), article: article ? normalizeText(article) : undefined, quantity, unit: unit ? normalizeText(unit) : undefined, price, amount, confidence, needsReview: confidence < REVIEW_SCORE, source: row.map((x) => x.text) })
  }
  return out
}

export function parseInvoice(items: OcrItem[]): ParsedInvoice {
  const boxed = items.filter((x) => x.text.trim()).map(box)
  const lines = groupRows(boxed).map((r) => ({ ...r[0], text: normalizeText(r.map((x) => x.text).join(' ')), score: avgScore(r), item: r[0].item, x: Math.min(...r.map((x) => x.x)), y: Math.min(...r.map((x) => x.y)), w: Math.max(...r.map((x) => x.x + x.w)) - Math.min(...r.map((x) => x.x)), h: Math.max(...r.map((x) => x.y + x.h)) - Math.min(...r.map((x) => x.y)) }))
  const supplier = parseSupplier(lines)
  const totals = parseTotals(lines)
  const binField = extractIdentifier(lines, /\b(?:бин|БИН)\b/i, bin)
  const iinField = extractIdentifier(lines, /\b(?:иин|ИИН)\b/i, iin)
  const invoice = extractIdentifier(lines, /(?:номер|№)\s*(?:накладной|сч[её]та|документа)?/i, /\d[\w/-]{1,}/)
  const documentNumber = extractIdentifier(lines, /(?:номер|№)\s*(?:документа|док\.?)/i, /\d[\w/-]{1,}/)
  const parsedBank = lines.filter((x) => /(?:ИИК|IBAN|БИК|БИН|банк|р\/с|расч[её]тн)/i.test(x.text))
  const bank = Object.fromEntries(parsedBank.map((x, i) => [`line_${i + 1}`, x.text]))
  const bankConfidence = avgScore(parsedBank)

  return {
    supplier_name: supplier,
    supplier_bin: binField,
    supplier_iin: iinField,
    invoice_number: invoice,
    invoice_date: parseDate(lines),
    document_number: documentNumber,
    bank_details: { value: bank, confidence: bankConfidence, source: parsedBank.map((x) => x.text), needsReview: parsedBank.length > 0 && bankConfidence < REVIEW_SCORE },
    total_amount: totals.total,
    vat_amount: totals.vat,
    items: parseTable(boxed),
    rawText: lines.map((x) => x.text).join('\n'),
  }
}
