import { beforeEach, describe, expect, test, vi } from 'vitest'

const extractPages = vi.fn()
const buildPdfSample = vi.fn()
vi.mock('@/server/embed-test/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/embed-test/extract')>()
  return {
    ...actual,
    extractPages: (...a: unknown[]) => extractPages(...a),
    buildPdfSample: (...a: unknown[]) => buildPdfSample(...a),
  }
})

const ocrCompare = vi.fn()
const proposeConfigs = vi.fn()
const judgeConfig = vi.fn()
vi.mock('@/server/embed-test/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/embed-test/claude')>()
  return {
    ...actual,
    createAnthropicClient: () => ({}),
    ocrCompare: (...a: unknown[]) => ocrCompare(...a),
    proposeConfigs: (...a: unknown[]) => proposeConfigs(...a),
    judgeConfig: (...a: unknown[]) => judgeConfig(...a),
  }
})

import { runEmbedTest, sampleChunks } from '@/server/embed-test/pipeline'
import { PdfUnreadableError } from '@/server/embed-test/extract'
import { hashBuffer } from '@/server/embed-test/file-hash'
import type { ChunkConfig, EmbedTestEvent, RefinePayload } from '@/lib/embed-test/types'

/** sha256 of the test buffer used by collect/collectRefine (new Uint8Array([0])). */
const BUF_HASH = hashBuffer(new Uint8Array([0]))

const config = (label: string): ChunkConfig => ({
  label,
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 200,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
})

const usage = { inputTokens: 10, outputTokens: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  extractPages.mockResolvedValue({
    pages: ['Texte page un.\n\nDeuxième paragraphe.', 'Texte page deux.'],
    totalPages: 2,
  })
  buildPdfSample.mockResolvedValue(new Uint8Array([1, 2, 3]))
  ocrCompare.mockResolvedValue({
    data: { verdict: 'text_ok', reason: 'ok', coverage: 0.95 },
    usage,
  })
  proposeConfigs.mockResolvedValue({ data: [config('A'), config('B')], usage })
  judgeConfig.mockResolvedValue({
    data: { score: 8, issues: [], summary: 'bien' },
    usage,
  })
})

async function collect(): Promise<EmbedTestEvent[]> {
  const events: EmbedTestEvent[] = []
  await runEmbedTest(new Uint8Array([0]), 'sonnet', (e) => events.push(e))
  return events
}

async function collectRefine(refine: RefinePayload): Promise<EmbedTestEvent[]> {
  const events: EmbedTestEvent[] = []
  await runEmbedTest(new Uint8Array([0]), 'sonnet', (e) => events.push(e), refine)
  return events
}

describe('runEmbedTest — nominal', () => {
  test('emits steps, configs, results, and a final report with usage totals', async () => {
    const events = await collect()
    const types = events.map((e) => e.type)
    expect(types).toContain('step')
    expect(types).toContain('configs')
    expect(types.filter((t) => t === 'config-result')).toHaveLength(2)
    const report = events.find((e) => e.type === 'report')
    expect(report).toBeDefined()
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('text_ok')
      expect(report.report.ranking).toHaveLength(2)
      expect(report.report.recommendation.difySettings).toContain('Mode : Général')
      // 1 ocr + 1 propose + 2 judges = 4 calls x usage
      expect(report.report.usage).toEqual({ inputTokens: 40, outputTokens: 20 })
    }
  })

  test('ranking sorts by score descending', async () => {
    judgeConfig
      .mockResolvedValueOnce({ data: { score: 3, issues: ['x'], summary: 's' }, usage })
      .mockResolvedValueOnce({ data: { score: 9, issues: [], summary: 's' }, usage })
    const events = await collect()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ranking[0]).toBe(1)
      expect(report.report.recommendation.configIndex).toBe(1)
    }
  })
})

describe('runEmbedTest — failures', () => {
  test('one judge failure → config marked failed, run continues', async () => {
    judgeConfig
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: { score: 6, issues: [], summary: 's' }, usage })
    const events = await collect()
    const results = events.filter((e) => e.type === 'config-result')
    expect(results).toHaveLength(2)
    expect(results.some((r) => r.type === 'config-result' && r.result.failed)).toBe(true)
    expect(events.some((e) => e.type === 'report')).toBe(true)
  })

  test('unreadable pdf → dedicated error event, no report', async () => {
    extractPages.mockRejectedValueOnce(new PdfUnreadableError())
    const events = await collect()
    const error = events.find((e) => e.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('pdf_unreadable')
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('proposeConfigs failure → fatal error event', async () => {
    proposeConfigs.mockRejectedValueOnce(new Error('api down'))
    const events = await collect()
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('all judges fail → all_judges_failed error event, no report', async () => {
    judgeConfig.mockRejectedValue(new Error('down'))
    const events = await collect()
    const results = events.filter((e) => e.type === 'config-result')
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.type === 'config-result' && r.result.failed)).toBe(true)
    const error = events.find((e) => e.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('all_judges_failed')
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('buildPdfSample PdfUnreadableError → pdf_unreadable, not ocr_compare_failed', async () => {
    buildPdfSample.mockRejectedValueOnce(new PdfUnreadableError())
    const events = await collect()
    const error = events.find((e) => e.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('pdf_unreadable')
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('empty text layer → no judgeConfig call, all configs failed, all_judges_failed', async () => {
    extractPages.mockResolvedValueOnce({ pages: ['', ''], totalPages: 2 })
    const events = await collect()
    expect(judgeConfig).not.toHaveBeenCalled()
    const results = events.filter((e) => e.type === 'config-result')
    expect(results).toHaveLength(2)
    for (const r of results) {
      if (r.type === 'config-result') {
        expect(r.result.failed).toBe(true)
        expect(r.result.chunkCount).toBe(0)
        expect(r.result.summary).toBe('Aucun chunk produit (texte vide ?)')
      }
    }
    const error = events.find((e) => e.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('all_judges_failed')
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('ocr_needed verdict propagates to recommendation', async () => {
    ocrCompare.mockResolvedValueOnce({
      data: { verdict: 'ocr_needed', reason: 'scanné', coverage: 0.05 },
      usage,
    })
    const events = await collect()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('ocr_needed')
      expect(report.report.recommendation.difySettings).toContain('ACTIVEZ le pipeline OCR')
    }
  })
})

describe('runEmbedTest — diagnostic & refine', () => {
  test('every run emits a diagnostic event after extraction', async () => {
    const events = await collect()
    const diag = events.find((e) => e.type === 'diagnostic')
    expect(diag).toBeDefined()
    if (diag?.type === 'diagnostic') {
      expect(diag.diagnostic.totalChars).toBeGreaterThan(0)
      expect(['structured', 'weakly_structured', 'flat']).toContain(
        diag.diagnostic.verdict,
      )
    }
    // diagnostic arrives before the configs event
    const types = events.map((e) => e.type)
    expect(types.indexOf('diagnostic')).toBeLessThan(types.indexOf('configs'))
  })

  test('multi-page flat document → diagnostic verdict flat, no join artifact', async () => {
    const flatPage = 'mot '.repeat(200).trim() // one continuous line, no \n
    extractPages.mockResolvedValueOnce({
      pages: [flatPage, flatPage, flatPage],
      totalPages: 3,
    })
    const events = await collect()
    const diag = events.find((e) => e.type === 'diagnostic')
    expect(diag).toBeDefined()
    if (diag?.type === 'diagnostic') {
      expect(diag.diagnostic.verdict).toBe('flat')
      expect(diag.diagnostic.paragraphBreaks).toBe(0)
    }
  })

  test('proposeConfigs receives diagnostic summary in extras on every run', async () => {
    await collect()
    const extras = proposeConfigs.mock.calls[0][4] as {
      diagnosticSummary?: string
      tested?: unknown[]
    }
    expect(extras.diagnosticSummary).toContain('Verdict')
    expect(extras.tested).toBeUndefined()
  })

  test('refine run: ocrCompare and buildPdfSample are never called, verdict reused', async () => {
    const refine: RefinePayload = {
      ocr: { verdict: 'ocr_needed', reason: 'scanné (tour 1)', coverage: 0.1 },
      tested: [{ config: config('A'), score: 2.5, issues: ['coupé'], round: 1 }],
      fileHash: BUF_HASH,
    }
    const events = await collectRefine(refine)
    expect(ocrCompare).not.toHaveBeenCalled()
    expect(buildPdfSample).not.toHaveBeenCalled()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('ocr_needed')
      expect(report.report.ocr.reason).toBe('scanné (tour 1)')
      // usage: 1 propose + 2 judges only (no ocr call)
      expect(report.report.usage).toEqual({ inputTokens: 30, outputTokens: 15 })
    }
    const ocrStep = events.find((e) => e.type === 'step' && e.id === 'ocr')
    expect(ocrStep?.type === 'step' && ocrStep.label).toContain('réutilisé')
    const extras = proposeConfigs.mock.calls[0][4] as { tested?: unknown[] }
    expect(extras.tested).toHaveLength(1)
  })

  test('manual config: propose never called, single judge, configs = [manual]', async () => {
    const manual = { ...config('Manuelle'), maxTokens: 1300, overlapTokens: 150 }
    const refine: RefinePayload = {
      ocr: { verdict: 'text_ok', reason: 'ok', coverage: 0.9 },
      tested: [{ config: config('A'), score: 3, issues: [], round: 1 }],
      fileHash: BUF_HASH,
      manual,
    }
    const events = await collectRefine(refine)
    expect(proposeConfigs).not.toHaveBeenCalled()
    expect(ocrCompare).not.toHaveBeenCalled()
    expect(judgeConfig).toHaveBeenCalledTimes(1)
    const cfgs = events.find((e) => e.type === 'configs')
    expect(cfgs?.type === 'configs' && cfgs.items).toEqual([manual])
    const report = events.find((e) => e.type === 'report')
    expect(report?.type === 'report' && report.report.ranking).toEqual([0])
  })

  test('judge receives the evaluated config and the diagnostic verdict', async () => {
    await collect()
    const args = judgeConfig.mock.calls[0]
    expect(args[2]).toMatchObject({ label: 'A' })
    expect(['structured', 'weakly_structured', 'flat']).toContain(args[4])
  })

  test('refine with mismatched fileHash → OCR recomputed (vision called)', async () => {
    const refine: RefinePayload = {
      ocr: { verdict: 'ocr_needed', reason: 'tour 1', coverage: 0.1 },
      tested: [{ config: config('A'), score: 2, issues: [], round: 1 }],
      fileHash: 'deadbeef-not-the-current-file',
    }
    const events = await collectRefine(refine)
    expect(ocrCompare).toHaveBeenCalledTimes(1)
    const ocrStep = events.find((e) => e.type === 'step' && e.id === 'ocr')
    expect(ocrStep?.type === 'step' && ocrStep.label).toContain('recalcul')
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') expect(report.report.ocr.verdict).toBe('text_ok') // from ocrCompare mock
  })

  test('refine without fileHash → OCR recomputed', async () => {
    const refine: RefinePayload = {
      ocr: { verdict: 'ocr_needed', reason: 'tour 1', coverage: 0.1 },
      tested: [{ config: config('A'), score: 2, issues: [], round: 1 }],
    }
    await collectRefine(refine)
    expect(ocrCompare).toHaveBeenCalledTimes(1)
  })

  test('report carries the file hash', async () => {
    const events = await collect()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report')
      expect(report.report.fileHash).toBe(hashBuffer(new Uint8Array([0])))
  })
})

describe('sampleChunks', () => {
  const makeChunks = (n: number) => Array.from({ length: n }, (_, i) => ({ text: String(i) }))

  test('length ≤ max → returns the same chunks unchanged', () => {
    const chunks = makeChunks(15)
    expect(sampleChunks(chunks)).toEqual(chunks)
    const small = makeChunks(3)
    expect(sampleChunks(small)).toEqual(small)
  })

  test('length 16 → exactly 15 unique chunks', () => {
    const sampled = sampleChunks(makeChunks(16))
    expect(sampled).toHaveLength(15)
    expect(new Set(sampled.map((c) => c.text)).size).toBe(15)
  })

  test('length 100 → exactly 15 unique chunks from head, middle, and tail', () => {
    const sampled = sampleChunks(makeChunks(100))
    expect(sampled).toHaveLength(15)
    expect(new Set(sampled.map((c) => c.text)).size).toBe(15)
  })
})
