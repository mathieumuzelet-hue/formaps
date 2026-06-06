import { describe, expect, test } from 'vitest'

import {
  applyEvent,
  buildRefinePayload,
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

const diagnostic = {
  totalChars: 100,
  paragraphBreaks: 2,
  lineBreaks: 5,
  avgParagraphTokens: 50,
  shortLineRatio: 0.1,
  verdict: 'structured' as const,
  notes: [],
}

const makeReport = (score: number) => ({
  ocr: { verdict: 'text_ok' as const, reason: 'r', coverage: 0.9 },
  ranking: [0],
  recommendation: { configIndex: 0, difySettings: 's', rationale: `score ${score}` },
  usage: { inputTokens: 1, outputTokens: 2 },
})

describe('applyEvent — v2', () => {
  test('diagnostic event is stored', () => {
    const state = run([{ type: 'diagnostic', diagnostic }])
    expect(state.diagnostic).toEqual(diagnostic)
  })

  test('report appends the round to history and sets bestSoFar', () => {
    const state = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 4, issues: ['x'], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(4) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    expect(state.history).toHaveLength(1)
    expect(state.history[0]).toMatchObject({ score: 4, round: 1 })
    expect(state.bestSoFar?.score).toBe(4)
    expect(state.bestSoFar?.round).toBe(1)
  })

  test('a worse later round does not displace bestSoFar', () => {
    const round1 = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 7, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(7) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    // simulate the hook's run() carry-over into round 2
    const round2Start = {
      ...initialState,
      status: 'running' as const,
      round: 2,
      history: round1.history,
      bestSoFar: round1.bestSoFar,
    }
    const round2 = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 3, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(3) },
    ].reduce(applyEvent, round2Start)
    expect(round2.history).toHaveLength(2)
    expect(round2.bestSoFar?.score).toBe(7)
    expect(round2.bestSoFar?.round).toBe(1)
  })
})

describe('buildRefinePayload', () => {
  test('null without a report', () => {
    expect(buildRefinePayload(initialState)).toBeNull()
  })

  test('builds ocr + last 30 tested entries', () => {
    const state = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 4, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(4) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    const payload = buildRefinePayload(state)
    expect(payload?.ocr.verdict).toBe('text_ok')
    expect(payload?.tested).toHaveLength(1)
  })
})
