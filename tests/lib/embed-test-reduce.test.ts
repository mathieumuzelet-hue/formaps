import { describe, expect, test } from 'vitest'

import {
  applyEvent,
  httpErrorText,
  initialState,
  type EmbedTestState,
} from '@/lib/embed-test/useEmbedTest'
import type { EmbedTestEvent } from '@/lib/embed-test/types'

const config = {
  label: 'A',
  mode: 'general' as const,
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

function run(events: EmbedTestEvent[]): EmbedTestState {
  return events.reduce(applyEvent, { ...initialState, status: 'running' })
}

describe('applyEvent', () => {
  test('accumulates steps, configs, results, report', () => {
    const report = {
      ocr: { verdict: 'text_ok' as const, reason: 'r', coverage: 0.9 },
      ranking: [0],
      recommendation: { configIndex: 0, difySettings: 's', rationale: 'r' },
      usage: { inputTokens: 1, outputTokens: 2 },
    }
    const state = run([
      { type: 'step', id: 'extract', label: 'Extraction…' },
      { type: 'configs', items: [config] },
      {
        type: 'config-result',
        result: { index: 0, score: 8, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report', report },
    ])
    expect(state.steps).toHaveLength(1)
    expect(state.configs).toHaveLength(1)
    expect(state.results).toHaveLength(1)
    expect(state.report).toEqual(report)
    expect(state.status).toBe('done')
  })

  test('error event → status error with message', () => {
    const state = run([{ type: 'error', code: 'pdf_unreadable', message: 'PDF illisible' }])
    expect(state.status).toBe('error')
    expect(state.error).toBe('PDF illisible')
  })
})

describe('httpErrorText', () => {
  test('maps known statuses to French messages', () => {
    expect(httpErrorText(413)).toContain('25 Mo')
    expect(httpErrorText(415)).toContain('PDF')
    expect(httpErrorText(503)).toContain('Anthropic')
    expect(httpErrorText(403)).toContain('admin')
    expect(httpErrorText(500)).toBeTruthy()
  })
})
