// Точка входа OCR-модуля (Часть 5, раздел 13 ТЗ). Прогоняет распознавание
// по всем страницам документа, склеивает текст и извлекает поля/товары.
// Используется и автоматически при сохранении (uploadDocument.ts), и по
// кнопке «Распознать текст» на уже загруженной накладной (DocumentDetail.tsx).

import { recognizeImage } from './paddleOcr'
import { extractFields, extractItems } from './parseInvoiceFields'
import type { OcrDocumentResult, OcrPageResult, OcrTextLine } from './types'

export type { OcrDocumentResult, OcrFields, RecognizedOcrItem } from './types'

// Сортировка строк в порядок чтения (сверху вниз, слева направо). Движок
// обычно уже возвращает строки примерно в таком порядке, но координаты
// иногда шумят на кривых/повёрнутых кадрах — берём y с допуском в
// половину высоты строки, чтобы строки на одной "визуальной линии" не
// переставились местами по x.
function sortReadingOrder(lines: OcrTextLine[]): OcrTextLine[] {
  return [...lines].sort((a, b) => {
    const rowTolerance = Math.max(a.height, b.height, 1) / 2
    if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y
    return a.x - b.x
  })
}

async function recognizePage(blob: Blob, pageIndex: number): Promise<OcrPageResult> {
  const lines = sortReadingOrder(await recognizeImage(blob))
  return { pageIndex, lines, rawText: lines.map((l) => l.text).join('\n') }
}

/**
 * Распознаёт текст на всех переданных изображениях (страницы одной
 * накладной, ОБРАБОТАННЫЕ версии — раздел 13 ТЗ) и извлекает из общего
 * текста поля документа + список товаров.
 *
 * Никогда не бросает исключение сама — если движок падает (например,
 * не удалось загрузить модель), это не должно ломать сохранение
 * накладной, только помечается в `engineError`, чтобы UI мог явно
 * сообщить об этом пользователю вместо тихого "ничего не нашли".
 */
export async function runDocumentOcr(pageBlobs: Blob[]): Promise<OcrDocumentResult> {
  const pages: OcrPageResult[] = []
  let engineError: string | null = null

  for (let i = 0; i < pageBlobs.length; i++) {
    try {
      pages.push(await recognizePage(pageBlobs[i], i))
    } catch (err) {
      engineError = err instanceof Error ? err.message : String(err)
      pages.push({ pageIndex: i, lines: [], rawText: '' })
    }
  }

  const combinedText = pages.map((p) => p.rawText).join('\n')
  const fields = extractFields(combinedText)
  const items = extractItems(pages.flatMap((p) => p.lines))

  return { pages, fields, items, engineError }
}
