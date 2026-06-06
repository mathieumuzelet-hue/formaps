/**
 * PDF text extraction (native text layer) + page sampling for the OCR
 * comparison. Server-only.
 */
import { PDFDocument } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'

/** Encrypted, corrupted, or not-a-PDF input. */
export class PdfUnreadableError extends Error {
  constructor(cause?: unknown) {
    super('PDF illisible — protégé ou corrompu')
    this.name = 'PdfUnreadableError'
    this.cause = cause
  }
}

export async function extractPages(
  buffer: Uint8Array,
): Promise<{ pages: string[]; totalPages: number }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    return { pages: text, totalPages }
  } catch (err) {
    throw new PdfUnreadableError(err)
  }
}

/**
 * Picks up to `count` page indices: first, last, and evenly spread interior
 * pages. Deterministic, sorted, unique.
 */
export function samplePageIndices(totalPages: number, count = 5): number[] {
  if (totalPages <= count) {
    return Array.from({ length: totalPages }, (_, i) => i)
  }
  const picked = new Set<number>()
  for (let k = 0; k < count; k++) {
    picked.add(Math.round((k * (totalPages - 1)) / (count - 1)))
  }
  return [...picked].sort((a, b) => a - b)
}

/** Copies the given pages into a fresh PDF (sent to Claude vision). */
export async function buildPdfSample(
  buffer: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  try {
    const src = await PDFDocument.load(buffer)
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, indices)
    for (const page of copied) out.addPage(page)
    return await out.save()
  } catch (err) {
    throw new PdfUnreadableError(err)
  }
}
