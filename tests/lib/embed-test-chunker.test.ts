import { describe, expect, test } from 'vitest'

import {
  chunkDocument,
  countTokens,
  normalizeSeparator,
  preprocess,
} from '@/lib/embed-test/chunker'
import type { ChunkConfig } from '@/lib/embed-test/types'

const base: ChunkConfig = {
  label: 't',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 100,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: false, removeUrlsEmails: false },
}

describe('normalizeSeparator', () => {
  test('unescapes \\n and \\t', () => {
    expect(normalizeSeparator('\\n\\n')).toBe('\n\n')
    expect(normalizeSeparator('\\t')).toBe('\t')
    expect(normalizeSeparator('###')).toBe('###')
  })
})

describe('preprocess', () => {
  test('removeExtraSpaces collapses runs of spaces/tabs and 3+ newlines', () => {
    const out = preprocess('a   b\t\tc\n\n\n\nd', {
      removeExtraSpaces: true,
      removeUrlsEmails: false,
    })
    expect(out).toBe('a b c\n\nd')
  })

  test('removeUrlsEmails strips URLs and emails', () => {
    const out = preprocess('voir https://exemple.fr/page et jean@aps.fr merci', {
      removeExtraSpaces: false,
      removeUrlsEmails: true,
    })
    expect(out).not.toContain('https://')
    expect(out).not.toContain('@')
    expect(out).toContain('voir')
    expect(out).toContain('merci')
  })
})

describe('chunkDocument — general', () => {
  test('empty text → no chunks', () => {
    expect(chunkDocument('', base)).toEqual([])
    expect(chunkDocument('   \n  ', base)).toEqual([])
  })

  test('short text → single chunk', () => {
    const chunks = chunkDocument('Bonjour le magasin.', base)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('Bonjour le magasin.')
  })

  test('splits on separator and respects maxTokens', () => {
    const para = 'mot '.repeat(60).trim() // ~60 tokens
    const text = `${para}\n\n${para}\n\n${para}`
    const chunks = chunkDocument(text, { ...base, maxTokens: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(countTokens(c.text)).toBeLessThanOrEqual(80)
    }
  })

  test('merges small paragraphs up to maxTokens', () => {
    const text = 'Un.\n\nDeux.\n\nTrois.'
    const chunks = chunkDocument(text, { ...base, maxTokens: 100 })
    expect(chunks).toHaveLength(1)
  })

  test('separator absent → falls back to token split', () => {
    const text = 'mot '.repeat(300).trim() // no \n\n anywhere
    const chunks = chunkDocument(text, { ...base, maxTokens: 100 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(countTokens(c.text)).toBeLessThanOrEqual(100)
    }
  })

  test('overlap prepends tail of previous chunk', () => {
    const para = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'
    const text = `${para}\n\n${para}\n\n${para}`
    const noOverlap = chunkDocument(text, { ...base, maxTokens: 15, overlapTokens: 0 })
    const withOverlap = chunkDocument(text, { ...base, maxTokens: 15, overlapTokens: 5 })
    expect(withOverlap.length).toBe(noOverlap.length)
    // Every chunk after the first is strictly longer with overlap on.
    for (let i = 1; i < withOverlap.length; i++) {
      expect(withOverlap[i].text.length).toBeGreaterThan(noOverlap[i].text.length)
    }
    expect(withOverlap[0].text).toBe(noOverlap[0].text)
  })
})
