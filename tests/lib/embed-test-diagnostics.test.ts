// tests/lib/embed-test-diagnostics.test.ts
import { describe, expect, test } from 'vitest'

import {
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
