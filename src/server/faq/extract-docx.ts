/**
 * .docx raw-text extraction for the FAQ builder. Server-only.
 * Mirrors the PdfUnreadableError contract of embed-test/extract.ts.
 */
import mammoth from 'mammoth'

/** Corrupted, password-protected, or not-a-docx input. */
export class DocxUnreadableError extends Error {
  constructor(cause?: unknown) {
    super('DOCX illisible — protégé ou corrompu')
    this.name = 'DocxUnreadableError'
    this.cause = cause
  }
}

export async function extractDocxText(buffer: Uint8Array): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    return value
  } catch (err) {
    throw new DocxUnreadableError(err)
  }
}
