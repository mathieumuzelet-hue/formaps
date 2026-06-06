import { describe, expect, test } from 'vitest'

import { parseEmbedTestEvent } from '@/lib/embed-test/parse'

describe('parseEmbedTestEvent', () => {
  test('parses a step event', () => {
    const ev = parseEmbedTestEvent(
      JSON.stringify({ type: 'step', id: 'extract', label: 'Extraction du texte…' }),
    )
    expect(ev).toEqual({ type: 'step', id: 'extract', label: 'Extraction du texte…' })
  })

  test('parses configs / config-result / report / error events', () => {
    const config = {
      label: 'c',
      mode: 'general',
      separator: '\\n\\n',
      maxTokens: 1024,
      overlapTokens: 0,
      preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
    }
    expect(
      parseEmbedTestEvent(JSON.stringify({ type: 'configs', items: [config] }))?.type,
    ).toBe('configs')
    expect(
      parseEmbedTestEvent(
        JSON.stringify({
          type: 'config-result',
          result: { index: 0, score: 7, issues: [], summary: 'ok', chunkCount: 12 },
        }),
      )?.type,
    ).toBe('config-result')
    expect(
      parseEmbedTestEvent(
        JSON.stringify({
          type: 'report',
          report: {
            ocr: { verdict: 'text_ok', reason: 'r', coverage: 0.98 },
            ranking: [0],
            recommendation: { configIndex: 0, difySettings: 's', rationale: 'r' },
            usage: { inputTokens: 1, outputTokens: 2 },
          },
        }),
      )?.type,
    ).toBe('report')
    expect(
      parseEmbedTestEvent(JSON.stringify({ type: 'error', code: 'x', message: 'm' }))
        ?.type,
    ).toBe('error')
  })

  test('returns null when a nested config violates chunkConfigSchema bounds', () => {
    const badConfig = {
      label: 'c',
      mode: 'general',
      separator: '\\n\\n',
      maxTokens: 50, // below chunkConfigSchema min of 100
      overlapTokens: 0,
      preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
    }
    expect(
      parseEmbedTestEvent(JSON.stringify({ type: 'configs', items: [badConfig] })),
    ).toBeNull()
  })

  test('returns null on invalid JSON, unknown type, or missing fields', () => {
    expect(parseEmbedTestEvent('{oops')).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify({ type: 'step' }))).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify(null))).toBeNull()
  })
})
