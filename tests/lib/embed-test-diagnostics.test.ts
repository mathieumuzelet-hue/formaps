// tests/lib/embed-test-diagnostics.test.ts
import { describe, expect, test } from 'vitest'

import {
  analyzePagesStructure,
  analyzeTextStructure,
  diagnosticPromptSummary,
} from '@/lib/embed-test/diagnostics'

const PARA = 'Une phrase de longueur raisonnable pour un paragraphe de test métier.'

describe('analyzeTextStructure', () => {
  test('structured text → structured verdict with positive note', () => {
    const text = `${PARA}\n\n${PARA}\n\n${PARA}`
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('structured')
    expect(d.paragraphBreaks).toBe(2)
    expect(d.avgParagraphTokens).toBeGreaterThan(0)
    expect(d.notes.some((n) => n.includes('bien structuré'))).toBe(true)
  })

  test('no paragraph breaks → flat with explanatory note', () => {
    const text = 'mot '.repeat(300).trim()
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('flat')
    expect(d.paragraphBreaks).toBe(0)
    expect(d.notes.some((n) => n.includes('Aucun saut de paragraphe'))).toBe(true)
  })

  test('very long paragraphs → weakly_structured', () => {
    const long = 'mot '.repeat(600).trim() // ~600 tokens, > 500
    const text = `${long}\n\n${long}`
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('weakly_structured')
    expect(d.notes.some((n) => n.includes('Paragraphes très longs'))).toBe(true)
  })

  test('majority of short lines → weakly_structured with table note', () => {
    const shortLines = Array(20).fill('Réf 123 | 4,99 €').join('\n')
    const text = `${PARA}\n\n${shortLines}`
    const d = analyzeTextStructure(text)
    expect(d.shortLineRatio).toBeGreaterThan(0.5)
    expect(d.verdict).toBe('weakly_structured')
    expect(d.notes.some((n) => n.includes('lignes courtes'))).toBe(true)
  })

  test('empty text → flat, zeroed metrics', () => {
    const d = analyzeTextStructure('')
    expect(d.verdict).toBe('flat')
    expect(d.totalChars).toBe(0)
    expect(d.avgParagraphTokens).toBe(0)
    expect(d.shortLineRatio).toBe(0)
  })

  // Boundary pins (characterization): the verdict thresholds use `>` not `>=`,
  // so values landing EXACTLY on the limit must stay `structured`.
  test('avg paragraph tokens exactly 500 stays structured (pins > vs >=)', () => {
    const para = 'mot '.repeat(500).trim() // exactly 500 tokens (verified)
    const text = `${para}\n\n${para}\n\n${para}`
    const d = analyzeTextStructure(text)
    expect(d.avgParagraphTokens).toBe(500)
    expect(d.verdict).toBe('structured')
  })

  test('shortLineRatio exactly 0.5 stays structured (pins > vs >=)', () => {
    const short = 'Réf 123 | 4,99 €' // < 40 chars
    // 5 short + 5 long paragraphs separated by \n\n: paragraphBreaks > 0,
    // 10 lines (5 short / 5 long) → ratio exactly 0.5, avg tokens ≤ 500.
    const text = [short, PARA, short, PARA, short, PARA, short, PARA, short, PARA].join(
      '\n\n',
    )
    const d = analyzeTextStructure(text)
    expect(d.shortLineRatio).toBe(0.5)
    expect(d.paragraphBreaks).toBeGreaterThan(0)
    expect(d.avgParagraphTokens).toBeLessThanOrEqual(500)
    expect(d.verdict).toBe('structured')
  })
})

describe('analyzePagesStructure', () => {
  test('multi-page flat document stays flat (no join artifact)', () => {
    const flatPage = 'mot '.repeat(200).trim() // one continuous line, no \n at all
    const d = analyzePagesStructure(Array(10).fill(flatPage))
    expect(d.paragraphBreaks).toBe(0)
    expect(d.verdict).toBe('flat')
  })

  test('aggregates metrics across pages', () => {
    // Lines kept above SHORT_LINE_CHARS (40) so the table heuristic stays clear;
    // the load-bearing assertion is paragraphBreaks = 1 per page (no pages-1 join artifact).
    const structured = `${PARA}\n\n${PARA}`
    const d = analyzePagesStructure([structured, structured])
    expect(d.paragraphBreaks).toBe(2) // 1 per page, never pages-1 artifacts
    expect(d.verdict).toBe('structured')
  })

  test('analyzeTextStructure(text) === analyzePagesStructure([text])', () => {
    const text = 'Para un.\n\nPara deux.\nligne'
    expect(analyzeTextStructure(text)).toEqual(analyzePagesStructure([text]))
  })
})

describe('diagnosticPromptSummary', () => {
  test('renders verdict, metrics and notes in French', () => {
    const d = analyzeTextStructure(`${PARA}\n\n${PARA}`)
    const out = diagnosticPromptSummary(d)
    expect(out).toContain('Verdict')
    expect(out).toContain('sauts de paragraphe')
    for (const note of d.notes) expect(out).toContain(note)
  })
})
