import { describe, expect, test, vi } from 'vitest'

import {
  EMBED_TEST_MODELS,
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

const validConfig = {
  label: 'Standard',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

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

  test('throws when fewer than 2 NEW configs survive dedup', async () => {
    const client = fakeClient({
      configs: [
        { ...validConfig, label: 'copie' },
        { ...validConfig, maxTokens: 512 },
      ],
    })
    await expect(
      proposeConfigs(
        client,
        'claude-sonnet-4-6',
        'texte',
        { totalPages: 1, totalChars: 10 },
        { tested },
      ),
    ).rejects.toThrow(/fewer than 2 valid configs/)
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
  test('returns validated judgement', async () => {
    const client = fakeClient({ score: 7.5, issues: ['phrase coupée p.2'], summary: 'correct' })
    const res = await judgeConfig(client, 'claude-sonnet-4-6', 'Standard', [
      { text: 'chunk un' },
      { text: 'chunk deux', parentText: 'parent' },
    ])
    expect(res.data.score).toBe(7.5)
    expect(res.data.issues).toHaveLength(1)
  })
})
