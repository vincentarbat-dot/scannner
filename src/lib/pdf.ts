// Генерация PDF на клиенте — раздел 19 ТЗ, Часть 3. Используем pdf-lib
// (добавлена в зависимости в этой части, см. PROGRESS.md).
//
// PDF собирается из ОБРАБОТАННЫХ страниц (см. imageProcessing.ts) — это и
// есть "Улучшенный документ" для бухгалтерии (раздел 20). Отдельно, PDF
// из оригиналов не генерируется — оригиналы доступны в карточке документа
// как самостоятельные файлы (раздел 15), скачиваются напрямую из Storage.

import { PDFDocument } from 'pdf-lib'

// Предполагаемое разрешение обработанных JPEG (см. imageProcessing.ts
// maxDimension) — используется, чтобы перевести пиксели в pt так, чтобы
// PDF-страница по размеру была близка к A4/Letter, а не была огромной
// "простынёй" в 2000pt.
const ASSUMED_DPI = 150

export async function buildDocumentPdf(pageBlobs: Blob[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create()

  for (const blob of pageBlobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const jpg = await pdfDoc.embedJpg(bytes)
    const widthPt = (jpg.width / ASSUMED_DPI) * 72
    const heightPt = (jpg.height / ASSUMED_DPI) * 72
    // Ориентация страницы PDF повторяет ориентацию кадра (раздел 19:
    // "иметь правильную ориентацию") — никаких принудительных поворотов.
    const page = pdfDoc.addPage([widthPt, heightPt])
    page.drawImage(jpg, { x: 0, y: 0, width: widthPt, height: heightPt })
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
}
