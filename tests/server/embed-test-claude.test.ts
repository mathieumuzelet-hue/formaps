import { describe, expect, test, vi } from 'vitest'

import {
  EMBED_TEST_MODELS,
  judgeConfig,
  ocrCompare,
  proposeConfigs,
  type AnthropicLike,
} from '@/server/embed-test/claude'

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
