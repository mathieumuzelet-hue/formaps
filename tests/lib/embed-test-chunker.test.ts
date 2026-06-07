import { describe, expect, test } from 'vitest'

import {
  chunkDocument,
  countTokens,
  escapeSeparator,
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

describe('escapeSeparator', () => {
  test('escapes real newlines and tabs', () => {
    expect(escapeSeparator('\n\n')).toBe('\\n\\n')
    expect(escapeSeparator('\t')).toBe('\\t')
  })
  test('idempotent on already-escaped forms and inert strings', () => {
    expect(escapeSeparator('\\n\\n')).toBe('\\n\\n')
    expect(escapeSeparator('###')).toBe('###')
    expect(escapeSeparator(escapeSeparator('\n'))).toBe('\\n')
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

describe('chunkDocument — parent-child', () => {
  const pc: ChunkConfig = {
    ...base,
    mode: 'parent-child',
    parentMaxTokens: 60,
    childMaxTokens: 20,
  }

  test('children carry their parent text', () => {
    // 8 paragraphs of DISTINCT vocabulary, 12-18 tokens each (132 total) —
    // verified with gpt-tokenizer. Total >> parentMaxTokens (60) so chunking
    // MUST yield several parents; each paragraph fits childMaxTokens (20) so
    // children stay paragraph-aligned and appear verbatim in their parent.
    const paras = [
      'alpha beta gamma delta epsilon zeta eta theta iota kappa',
      'lambda mu nu xi omicron pi rho sigma tau upsilon',
      'phi chi psi omega digamma stigma koppa sampi san sho',
      'aleph beth gimel daleth he waw zayin heth teth yodh',
      'kaph lamedh mem nun samekh ayin pe sadhe qoph resh',
      'shin taw fehu uruz thurisaz ansuz raido kenaz gebo wunjo',
      'hagalaz nauthiz isa jera eihwaz perthro algiz',
      'sowilo tiwaz berkano ehwaz mannaz laguz ingwaz',
    ]
    const text = paras.join('\n\n')
    const chunks = chunkDocument(text, pc)
    expect(chunks.length).toBeGreaterThan(1)
    // Multi-parent guaranteed: a regression that sizes parents with
    // config.maxTokens (100) or returns the whole document as parentText
    // cannot satisfy ≥2 distinct parents AND the ≤60-token cap below.
    expect(new Set(chunks.map((c) => c.parentText)).size).toBeGreaterThanOrEqual(2)
    for (const c of chunks) {
      expect(c.parentText).toBeDefined()
      expect(c.parentText).toContain(c.text)
      expect(countTokens(c.text)).toBeLessThanOrEqual(20)
      expect(countTokens(c.parentText!)).toBeLessThanOrEqual(60)
    }
  })

  test('every child belongs to exactly one parent', () => {
    const text = 'Un deux trois.\n\nQuatre cinq six.\n\nSept huit neuf.'
    const chunks = chunkDocument(text, pc)
    const parents = new Set(chunks.map((c) => c.parentText))
    expect(parents.size).toBeGreaterThanOrEqual(1)
    for (const c of chunks) expect(c.parentText).toContain(c.text)
  })

  test('childMaxTokens > parentMaxTokens degenerates to one child per parent', () => {
    // childMaxTokens > parentMaxTokens is schema-LEGAL in general: the schema
    // has no child < parent refinement, so this shape can come from
    // Claude-proposed configs and the chunker must tolerate it without
    // throwing. (This particular config only fails schema validation because
    // parentMaxTokens 60 < min 200 — unrelated to the child/parent ordering.)
    const degenerate: ChunkConfig = {
      ...base,
      mode: 'parent-child',
      parentMaxTokens: 60,
      childMaxTokens: 2000,
    }
    // Each paragraph is ~36-39 tokens: alone it fits a 60-token parent, but
    // any two together exceed it — so every paragraph becomes its own parent.
    const paras = [
      'alpha beta gamma delta epsilon zeta eta theta iota kappa alpha beta gamma delta epsilon zeta eta theta iota kappa alpha beta gamma delta epsilon zeta eta theta iota kappa',
      'lambda mu nu xi omicron pi rho sigma tau upsilon lambda mu nu xi omicron pi rho sigma tau upsilon lambda mu nu xi omicron pi rho sigma tau upsilon',
      'phi chi psi omega aleph beth gimel daleth he waw phi chi psi omega aleph beth gimel daleth he waw phi chi psi omega aleph beth gimel daleth he waw',
      'zayin heth teth yodh kaph lamedh mem nun samekh ayin zayin heth teth yodh kaph lamedh mem nun samekh ayin',
    ]
    const text = paras.join('\n\n')
    let chunks: ReturnType<typeof chunkDocument> = []
    expect(() => {
      chunks = chunkDocument(text, degenerate)
    }).not.toThrow()
    expect(chunks.length).toBeGreaterThan(1)
    const parents = new Set(chunks.map((c) => c.parentText))
    // Exactly one child per parent: each child IS its parent.
    expect(parents.size).toBe(chunks.length)
    for (const c of chunks) {
      expect(c.text).toBe(c.parentText)
    }
  })
})
