// Извлечение полей накладной (раздел 13 ТЗ) из уже распознанного OCR-
// текста. Первая итерация, чисто эвристическая (регулярки по ключевым
// словам и типичным форматам казахстанских накладных/счетов-фактур) — без
// отдельной обученной NER-модели, как и было решено не делать в рамках
// Части 5 (движок — только OCR, PaddleOCR текст не структурирует сам).
// Осознанно консервативный подход: лучше оставить поле пустым, чем
// заполнить его чем-то неверным — раздел 13 в любом случае требует
// сохранить ручную правку, так что недостающее пользователь дозаполнит
// сам, а вот неверно "угаданное" значение легко пропустить при проверке.

import type { OcrFields, OcrTextLine, RecognizedOcrItem } from './types'

const MONTHS: Record<string, string> = {
  января: '01',
  февраля: '02',
  марта: '03',
  апреля: '04',
  мая: '05',
  июня: '06',
  июля: '07',
  августа: '08',
  сентября: '09',
  октября: '10',
  ноября: '11',
  декабря: '12',
}

function normalizeAmount(raw: string): number | null {
  // "12 345,67" / "12345.67" / "12 345" → 12345.67
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/[^\d.,]/g, '')
    .replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function pad2(n: string | number): string {
  return String(n).padStart(2, '0')
}

/** Ищет и нормализует дату в формате dd.mm.yyyy или "12 января 2026". */
function extractDate(text: string): string | null {
  const numeric = text.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/)
  if (numeric) {
    const [, d, m, yRaw] = numeric
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw
    const day = Number(d)
    const month = Number(m)
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${pad2(m)}-${pad2(d)}`
    }
  }
  const monthNamePattern = new RegExp(
    `\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})\\s+(\\d{4})\\b`,
    'i'
  )
  const named = text.match(monthNamePattern)
  if (named) {
    const [, d, monthName, y] = named
    const month = MONTHS[monthName.toLowerCase()]
    if (month) return `${y}-${month}-${pad2(d)}`
  }
  return null
}

/** БИН/ИИН — в Казахстане всегда ровно 12 цифр. */
function extractBin(text: string): string | null {
  const labeled = text.match(/(?:БИН|ИИН)[^\d]{0,10}(\d{12})/i)
  if (labeled) return labeled[1]
  const bare = text.match(/\b(\d{12})\b/)
  return bare ? bare[1] : null
}

function extractInvoiceNumber(text: string): string | null {
  const labeled = text.match(
    /(?:накладн\w*|сч[её]т-фактур\w*|расходн\w*\s*накладн\w*)\D{0,15}№?\s*([A-Za-zА-Яа-яЁё0-9\-/]{1,20})/i
  )
  if (labeled) return labeled[1]
  const bare = text.match(/№\s*([A-Za-zА-Яа-яЁё0-9\-/]{1,20})/)
  return bare ? bare[1] : null
}

function findAmountOnLabeledLine(lines: string[], labelPattern: RegExp): number | null {
  for (const line of lines) {
    if (labelPattern.test(line)) {
      // берём последнее число в строке — обычно сумма стоит в конце
      const matches = [...line.matchAll(/[\d][\d\s]*(?:[.,]\d{1,2})?/g)].map((m) => m[0])
      if (matches.length > 0) {
        const amount = normalizeAmount(matches[matches.length - 1])
        if (amount !== null) return amount
      }
    }
  }
  return null
}

function extractSupplierName(text: string, lines: string[]): string | null {
  const labeled = text.match(/(?:поставщик|продавец|отправитель)\s*:?\s*([^\n]{3,120})/i)
  if (labeled) return labeled[1].trim()
  const prefixed = lines.find((line) => /\b(ТОО|АО|ИП|ПК|ГУ|КГП)\b/.test(line))
  return prefixed ? prefixed.trim() : null
}

const BANK_LINE_PATTERN = /ИИК|БИК|расч[её]тный счет|расч[её]тный счёт|банк[а-я]*\b|KZ\d{2}[A-Z0-9]{16}/i

function extractBankDetails(lines: string[]): string | null {
  const bankLines = lines.filter((line) => BANK_LINE_PATTERN.test(line))
  if (bankLines.length === 0) return null
  return bankLines.join('\n')
}

export function extractFields(rawText: string): OcrFields {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return {
    supplier_name: extractSupplierName(rawText, lines),
    supplier_bin: extractBin(rawText),
    invoice_number: extractInvoiceNumber(rawText),
    invoice_date: extractDate(rawText),
    total_amount: findAmountOnLabeledLine(lines, /итого\s*к\s*оплате|всего\s*к\s*оплате|итого\b|общая\s*сумма/i),
    vat_amount: findAmountOnLabeledLine(lines, /ндс/i),
    bank_details: extractBankDetails(lines),
  }
}

const UNIT_PATTERN = /\b(шт|кг|г|л|мл|м|см|уп|упак|пач|компл|пар|ед)\.?\b/i
const NUMBER_PATTERN = /\d[\d\s]*(?:[.,]\d{1,2})?/g

/**
 * Очень грубая эвристика таблицы товаров: строка с текстом и 2+ числами
 * считается строкой товара (название = текст до первого числа, дальше по
 * количеству чисел раскладываем в кол-во/цену/сумму). Заведомо не
 * идеально на реальных сканах с неровной вёрсткой таблиц — раздел 13 ТЗ
 * поэтому и требует сохранить ручную правку, таблица товаров в карточке
 * документа (DocumentDetail.tsx) полностью редактируемая.
 */
export function extractItems(lines: OcrTextLine[]): RecognizedOcrItem[] {
  const items: RecognizedOcrItem[] = []
  for (const line of lines) {
    const text = line.text.trim()
    if (!text) continue
    if (/итого|всего\s*к\s*оплате|ндс\b|поставщик|продавец|покупатель|получатель|наименование\s*товар/i.test(text)) {
      continue
    }
    const numberMatches = [...text.matchAll(NUMBER_PATTERN)].map((m) => m[0].trim()).filter(Boolean)
    if (numberMatches.length < 2) continue

    const firstNumberIndex = text.search(NUMBER_PATTERN)
    const name = text.slice(0, firstNumberIndex).trim().replace(/[.,;:\-]+$/, '')
    if (name.length < 2) continue

    const numbers = numberMatches.map(normalizeAmount).filter((n): n is number => n !== null)
    if (numbers.length < 2) continue

    const unitMatch = text.match(UNIT_PATTERN)
    const amount = numbers[numbers.length - 1]
    const price = numbers.length >= 3 ? numbers[numbers.length - 2] : undefined
    const quantity = numbers[0] !== amount ? numbers[0] : undefined

    items.push({
      name,
      quantity,
      unit: unitMatch ? unitMatch[0] : undefined,
      price,
      amount,
    })
  }
  return items
}
