/**
 * RFC 4180 CSV for the Dify Q&A import (comma-separated, UTF-8, CRLF).
 * NO BOM and NO Excel formula guard on purpose: this file is machine-ingested
 * by Dify (Knowledge → Import → Q&A mode), never opened in a spreadsheet —
 * prefixing values would pollute the indexed content. (The faq-gaps export
 * keeps the opposite convention: `;` + BOM, Excel-bound.)
 */

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

export function buildFaqCsv(
  items: ReadonlyArray<{ question: string; answer: string }>,
): string {
  const lines = ['question,answer']
  for (const it of items) lines.push(`${csvField(it.question)},${csvField(it.answer)}`)
  return lines.join('\r\n') + '\r\n'
}
