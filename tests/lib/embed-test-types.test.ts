import { describe, expect, test } from 'vitest'

import { chunkConfigSchema } from '@/lib/embed-test/types'

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
