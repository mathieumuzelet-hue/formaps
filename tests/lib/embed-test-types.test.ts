import { describe, expect, test } from 'vitest'

import { chunkConfigSchema, configKey, refinePayloadSchema } from '@/lib/embed-test/types'

const valid = {
  label: 'Standard 1024',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('chunkConfigSchema', () => {
  test('accepts a valid general config', () => {
    expect(chunkConfigSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects overlap >= maxTokens', () => {
    expect(
      chunkConfigSchema.safeParse({ ...valid, overlapTokens: 1024 }).success,
    ).toBe(false)
  })

  test('rejects maxTokens out of Dify bounds', () => {
    expect(chunkConfigSchema.safeParse({ ...valid, maxTokens: 50 }).success).toBe(false)
    expect(chunkConfigSchema.safeParse({ ...valid, maxTokens: 5000 }).success).toBe(false)
  })

  test('parent-child requires parent/child token sizes', () => {
    expect(
      chunkConfigSchema.safeParse({ ...valid, mode: 'parent-child' }).success,
    ).toBe(false)
    expect(
      chunkConfigSchema.safeParse({
        ...valid,
        mode: 'parent-child',
        parentMaxTokens: 2000,
        childMaxTokens: 400,
      }).success,
    ).toBe(true)
  })
})

describe('refinePayloadSchema', () => {
  const tested = {
    config: valid,
    score: 3.2,
    issues: ['phrases coupées'],
    round: 1,
  }
  const ocr = { verdict: 'text_ok', reason: 'ok', coverage: 0.9 }

  test('accepts a valid payload', () => {
    expect(refinePayloadSchema.safeParse({ ocr, tested: [tested] }).success).toBe(true)
  })

  test('rejects empty tested and more than 30 entries', () => {
    expect(refinePayloadSchema.safeParse({ ocr, tested: [] }).success).toBe(false)
    expect(
      refinePayloadSchema.safeParse({ ocr, tested: Array(31).fill(tested) }).success,
    ).toBe(false)
  })

  test('requires a complete ocr verdict', () => {
    expect(
      refinePayloadSchema.safeParse({ ocr: { verdict: 'text_ok' }, tested: [tested] })
        .success,
    ).toBe(false)
  })
})

describe('configKey', () => {
  test('ignores label and rationale', () => {
    expect(configKey({ ...valid, label: 'A' } as never)).toBe(
      configKey({ ...valid, label: 'B', rationale: 'x' } as never),
    )
  })

  test('distinguishes structural fields', () => {
    expect(configKey(valid as never)).not.toBe(
      configKey({ ...valid, maxTokens: 512 } as never),
    )
    expect(configKey(valid as never)).not.toBe(
      configKey({
        ...valid,
        mode: 'parent-child',
        parentMaxTokens: 2000,
        childMaxTokens: 400,
      } as never),
    )
  })
})
