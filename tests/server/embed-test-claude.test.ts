import { describe, expect, test, vi } from 'vitest'

import {
  CONFIG_PROPERTIES,
  EMBED_TEST_MODELS,
  OCR_TOOL_SCHEMA,
  judgeConfig,
  ocrCompare,
  proposeConfigs,
  type AnthropicLike,
} from '@/server/embed-test/claude'
import type { TestedConfig } from '@/lib/embed-test/types'

function fakeClient(toolInput: unknown): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 't1', name: 'output', input: toolInput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as AnthropicLike
}

/**
 * Fake client whose `create` resolves a DIFFERENT payload per call (one entry
 * per attempt). Each entry may be a bare tool input (defaults to 100/50 usage)
 * or `{ input, usage: { input_tokens, output_tokens } }` to control usage.
 */
function fakeClientSequence(
  inputs: Array<unknown | { input: unknown; usage: { input_tokens: number; output_tokens: number } }>,
): AnthropicLike {
  const create = vi.fn()
  for (const entry of inputs) {
    const isWrapped =
      entry !== null &&
      typeof entry === 'object' &&
      'input' in (entry as Record<string, unknown>) &&
      'usage' in (entry as Record<string, unknown>)
    const input = isWrapped ? (entry as { input: unknown }).input : entry
    const usage = isWrapped
      ? (entry as { usage: { input_tokens: number; output_tokens: number } }).usage
      : { input_tokens: 100, output_tokens: 50 }
    create.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't1', name: 'output', input }],
      usage,
    })
  }
  return { messages: { create } } as unknown as AnthropicLike
}

const validConfig = {
  label: 'Standard',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('tool schema bounds (E-5)', () => {
  test('OCR coverage is bounded to [0,1]', () => {
    const props = OCR_TOOL_SCHEMA.properties as Record<string, Record<string, unknown>>
    const cov = props.coverage
    expect(cov.minimum).toBe(0)
    expect(cov.maximum).toBe(1)
  })
  test('maxTokens is bounded 100..4000', () => {
    const mt = CONFIG_PROPERTIES.maxTokens as Record<string, unknown>
    expect(mt.minimum).toBe(100)
    expect(mt.maximum).toBe(4000)
  })
  test('overlapTokens has a non-negative minimum', () => {
    const ot = CONFIG_PROPERTIES.overlapTokens as Record<string, unknown>
    expect(ot.minimum).toBe(0)
  })
})

describe('model map', () => {
  test('exact model ids', () => {
    expect(EMBED_TEST_MODELS.sonnet).toBe('claude-sonnet-4-6')
    expect(EMBED_TEST_MODELS.opus).toBe('claude-opus-4-8')
  })
})

describe('ocrCompare', () => {
  test('returns validated verdict + usage', async () => {
    const client = fakeClient({ verdict: 'text_ok', reason: 'couche texte fidèle', coverage: 0.97 })
    const res = await ocrCompare(client, 'claude-sonnet-4-6', 'cGRm', 'texte natif')
    expect(res.data.verdict).toBe('text_ok')
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  test('throws on schema mismatch', async () => {
    const client = fakeClient({ verdict: 'maybe' })
    await expect(
      ocrCompare(client, 'claude-sonnet-4-6', 'cGRm', 'texte'),
    ).rejects.toThrow()
  })

  test('rejects when the response carries no tool_use block', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    } as unknown as AnthropicLike
    await expect(
      ocrCompare(client, 'claude-sonnet-4-6', 'cGRm', 'texte'),
    ).rejects.toThrow(/no tool_use block/)
  })
})

describe('proposeConfigs', () => {
  test('returns validated configs', async () => {
    const client = fakeClient({ configs: [validConfig, { ...validConfig, maxTokens: 512 }] })
    const res = await proposeConfigs(client, 'claude-sonnet-4-6', 'texte du doc', {
      totalPages: 3,
      totalChars: 5000,
    })
    expect(res.data).toHaveLength(2)
  })

  test('drops individually-invalid configs and keeps the valid ones', async () => {
    const client = fakeClient({
      configs: [validConfig, { ...validConfig, maxTokens: 99999 }, { ...validConfig, maxTokens: 512 }],
    })
    const res = await proposeConfigs(client, 'claude-sonnet-4-6', 'texte', {
      totalPages: 1,
      totalChars: 10,
    })
    expect(res.data).toHaveLength(2)
    expect(res.data.map((c) => c.maxTokens)).toEqual([1024, 512])
  })

  test('rejects when fewer than 2 configs survive validation', async () => {
    const client = fakeClient({
      configs: [validConfig, { ...validConfig, maxTokens: 99999 }],
    })
    await expect(
      proposeConfigs(client, 'claude-sonnet-4-6', 'texte', { totalPages: 1, totalChars: 10 }),
    ).rejects.toThrow(/fewer than 2 valid configs/)
  })
})

describe('proposeConfigs — refine extras', () => {
  const tested: TestedConfig[] = [
    {
      config: { ...validConfig, label: 'Tour1' } as TestedConfig['config'],
      score: 3.2,
      issues: ['phrases coupées p.2'],
      round: 1,
    },
  ]

  test('prompt contains diagnostic and history blocks when provided', async () => {
    // Both proposed configs differ structurally from `tested` so neither is
    // deduped — this test only asserts on the prompt, not the survivor count.
    const client = fakeClient({
      configs: [
        { ...validConfig, maxTokens: 512 },
        { ...validConfig, maxTokens: 2000 },
      ],
    })
    await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { diagnosticSummary: 'Verdict : texte plat.', tested },
    )
    const params = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const prompt = (params as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).toContain('DIAGNOSTIC DU TEXTE EXTRAIT')
    expect(prompt).toContain('Verdict : texte plat.')
    expect(prompt).toContain('CONFIGS DÉJÀ TESTÉES')
    expect(prompt).toContain('Tour1')
    expect(prompt).toContain('3.2/10')
    expect(prompt).toContain('phrases coupées p.2')
    expect(prompt).toContain('NOUVELLES')
  })

  test('drops re-proposed configs identical to already-tested ones', async () => {
    // Claude re-proposes the tested config (different label) + 2 new ones.
    const client = fakeClient({
      configs: [
        { ...validConfig, label: 'copie déguisée' },
        { ...validConfig, maxTokens: 512 },
        { ...validConfig, maxTokens: 2000 },
      ],
    })
    const res = await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { tested },
    )
    expect(res.data).toHaveLength(2)
    expect(res.data.map((c) => c.maxTokens)).toEqual([512, 2000])
  })

  test('refine: first attempt all-duplicates, retry yields 1 fresh → resolves with it (2 calls, summed usage)', async () => {
    const client = fakeClientSequence([
      // Attempt 1: both configs structurally identical to `tested` → all dropped.
      {
        input: { configs: [{ ...validConfig, label: 'copie A' }, { ...validConfig, label: 'copie B' }] },
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      // Attempt 2 (retry): one genuinely new config.
      {
        input: { configs: [{ ...validConfig, maxTokens: 512 }] },
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ])
    const res = await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { tested },
    )
    expect(res.data).toHaveLength(1)
    expect(res.data[0].maxTokens).toBe(512)
    const create = client.messages.create as ReturnType<typeof vi.fn>
    expect(create).toHaveBeenCalledTimes(2)
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 100 })
    // The retry prompt carries the rejected-duplicates feedback block.
    const retryParams = create.mock.calls[1][0] as { messages: Array<{ content: string }> }
    const retryPrompt = retryParams.messages[0].content
    expect(retryPrompt).toContain('PROPOSITIONS REJETÉES')
    expect(retryPrompt).toContain('STRUCTURELLEMENT DIFFÉRENTES')
    // The duplicate's label (as actually proposed) is echoed back.
    expect(retryPrompt).toContain('copie A')
  })

  test('refine: attempt 1 yields 1 fresh, retry call REJECTS → resolves with attempt-1 fresh (2 calls, attempt-1 usage)', async () => {
    const create = vi.fn()
    // Attempt 1: 1 fresh (maxTokens 512) + 1 duplicate (identical to `tested`).
    create.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'output',
          input: { configs: [{ ...validConfig, maxTokens: 512 }, { ...validConfig, label: 'copie' }] },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    // Attempt 2 (retry): API-level failure.
    create.mockRejectedValueOnce(new Error('529 overloaded'))
    const client = { messages: { create } } as unknown as AnthropicLike
    const res = await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { tested },
    )
    expect(res.data).toHaveLength(1)
    expect(res.data[0].maxTokens).toBe(512)
    expect(create).toHaveBeenCalledTimes(2)
    // Usage reflects attempt 1 only — the failed retry contributes nothing.
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  test('refine: attempt 1 all-duplicates, retry call REJECTS → still throws (2 calls)', async () => {
    const create = vi.fn()
    create.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'output',
          input: { configs: [{ ...validConfig, label: 'copie' }, { ...validConfig, label: 'copie 2' }] },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    create.mockRejectedValueOnce(new Error('529 overloaded'))
    const client = { messages: { create } } as unknown as AnthropicLike
    await expect(
      proposeConfigs(
        client,
        'claude-sonnet-4-6',
        'texte',
        { totalPages: 1, totalChars: 10 },
        { tested },
      ),
    ).rejects.toThrow(/no new configs after retry/)
    expect(create).toHaveBeenCalledTimes(2)
  })

  test('refine: both attempts all-duplicates → rejects after retry (2 calls)', async () => {
    const dup = { configs: [{ ...validConfig, label: 'copie' }, { ...validConfig, label: 'copie 2' }] }
    const client = fakeClientSequence([dup, dup])
    await expect(
      proposeConfigs(
        client,
        'claude-sonnet-4-6',
        'texte',
        { totalPages: 1, totalChars: 10 },
        { tested },
      ),
    ).rejects.toThrow(/no new configs after retry/)
    expect(client.messages.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2)
  })

  test('refine: first attempt has 2 fresh → no retry (1 call)', async () => {
    const client = fakeClientSequence([
      { configs: [{ ...validConfig, maxTokens: 512 }, { ...validConfig, maxTokens: 2000 }] },
    ])
    const res = await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { tested },
    )
    expect(res.data).toHaveLength(2)
    expect(client.messages.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  test('plain run: fewer than 2 valid → throws, no retry (1 call)', async () => {
    const client = fakeClientSequence([
      { configs: [validConfig, { ...validConfig, maxTokens: 99999 }] },
    ])
    await expect(
      proposeConfigs(client, 'claude-sonnet-4-6', 'texte', { totalPages: 1, totalChars: 10 }),
    ).rejects.toThrow(/fewer than 2 valid configs/)
    expect(client.messages.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  test('without extras, behavior is unchanged (no blocks in prompt)', async () => {
    const client = fakeClient({ configs: [validConfig, { ...validConfig, maxTokens: 512 }] })
    await proposeConfigs(client, 'claude-sonnet-4-6', 'texte', {
      totalPages: 1,
      totalChars: 10,
    })
    const params = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const prompt = (params as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).not.toContain('DIAGNOSTIC DU TEXTE EXTRAIT')
    expect(prompt).not.toContain('CONFIGS DÉJÀ TESTÉES')
  })
})

describe('judgeConfig', () => {
  const judgeConfigInput = {
    label: 'Standard',
    mode: 'general',
    separator: '\\n\\n',
    maxTokens: 1024,
    overlapTokens: 128,
    preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
  } as const

  function judgePrompt(client: AnthropicLike): string {
    const params = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    return (params as { messages: Array<{ content: string }> }).messages[0].content
  }

  test('returns validated judgement', async () => {
    const client = fakeClient({ score: 7.5, issues: ['phrase coupée p.2'], summary: 'correct' })
    const res = await judgeConfig(
      client,
      'claude-sonnet-4-6',
      judgeConfigInput,
      [{ text: 'chunk un' }, { text: 'chunk deux', parentText: 'parent' }],
      'structured',
    )
    expect(res.data.score).toBe(7.5)
    expect(res.data.issues).toHaveLength(1)
  })

  test('prompt carries the evaluated config context, escaped separator, and overlap calibration', async () => {
    const client = fakeClient({ score: 7, issues: [], summary: 'ok' })
    await judgeConfig(
      client,
      'claude-sonnet-4-6',
      { ...judgeConfigInput, separator: '\n\n' },
      [{ text: 'chunk un' }],
      'structured',
    )
    const prompt = judgePrompt(client)
    expect(prompt).toContain('CONFIG ÉVALUÉE')
    expect(prompt).toContain('\\n\\n')
    expect(prompt).toContain('ne les compte PAS comme défaut')
    expect(prompt).toContain('Standard')
  })

  test('parent-child config exposes parent/child sizes in the prompt', async () => {
    const client = fakeClient({ score: 7, issues: [], summary: 'ok' })
    await judgeConfig(
      client,
      'claude-sonnet-4-6',
      {
        ...judgeConfigInput,
        mode: 'parent-child',
        parentMaxTokens: 2000,
        childMaxTokens: 400,
      },
      [{ text: 'chunk un' }],
      'structured',
    )
    const prompt = judgePrompt(client)
    expect(prompt).toContain('parent 2000')
    expect(prompt).toContain('enfant 400')
  })

  test('relative-quality instruction appears for non-structured verdicts', async () => {
    const client = fakeClient({ score: 7, issues: [], summary: 'ok' })
    await judgeConfig(client, 'claude-sonnet-4-6', judgeConfigInput, [{ text: 'c' }], 'flat')
    expect(judgePrompt(client)).toContain('RELATIVE')
  })

  test('relative-quality instruction is absent for the structured verdict', async () => {
    const client = fakeClient({ score: 7, issues: [], summary: 'ok' })
    await judgeConfig(client, 'claude-sonnet-4-6', judgeConfigInput, [{ text: 'c' }], 'structured')
    expect(judgePrompt(client)).not.toContain('RELATIVE')
  })
})
