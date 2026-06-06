import { describe, expect, test } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import {
  buildPdfSample,
  extractPages,
  PdfUnreadableError,
  samplePageIndices,
} from '@/server/embed-test/extract'

describe('samplePageIndices', () => {
  test('small documents return every page', () => {
    expect(samplePageIndices(1)).toEqual([0])
    expect(samplePageIndices(3)).toEqual([0, 1, 2])
    expect(samplePageIndices(5)).toEqual([0, 1, 2, 3, 4])
  })

  test('large documents: first + last + 3 spread, sorted unique', () => {
    const idx = samplePageIndices(20)
    expect(idx).toHaveLength(5)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(19)
    expect([...new Set(idx)]).toEqual(idx)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})

async function makePdf(pagesText: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pagesText) {
    const page = doc.addPage()
    page.drawText(text, { x: 50, y: 700, size: 14, font })
  }
  return doc.save()
}

describe('extractPages', () => {
  test('extracts text page by page', async () => {
    const pdf = await makePdf(['Page un contenu', 'Page deux contenu'])
    const { pages, totalPages } = await extractPages(pdf)
    expect(totalPages).toBe(2)
    expect(pages[0]).toContain('Page un')
    expect(pages[1]).toContain('Page deux')
  })

  test('garbage bytes → PdfUnreadableError', async () => {
    await expect(extractPages(new TextEncoder().encode('not a pdf'))).rejects.toThrow(
      PdfUnreadableError,
    )
  })
})

describe('buildPdfSample', () => {
  test('builds a sub-PDF with only the requested pages', async () => {
    const pdf = await makePdf(['A', 'B', 'C', 'D'])
    const sample = await buildPdfSample(pdf, [0, 3])
    const reloaded = await PDFDocument.load(sample)
    expect(reloaded.getPageCount()).toBe(2)
  })
})
