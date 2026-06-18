import { describe, expect, test } from 'vitest'
import { normalizeSeparator, escapeSeparator } from '@/lib/embed-test/separator'

describe('normalizeSeparator', () => {
  test('unescapes \\n and \\t to real characters', () => {
    expect(normalizeSeparator('\\n\\n')).toBe('\n\n')
    expect(normalizeSeparator('a\\tb')).toBe('a\tb')
  })
  test('leaves a real newline untouched', () => {
    expect(normalizeSeparator('\n\n')).toBe('\n\n')
  })
})

describe('escapeSeparator', () => {
  test('escapes real newline/tab to two-char forms', () => {
    expect(escapeSeparator('\n\n')).toBe('\\n\\n')
    expect(escapeSeparator('a\tb')).toBe('a\\tb')
  })
  test('idempotent on already-escaped input', () => {
    expect(escapeSeparator('\\n\\n')).toBe('\\n\\n')
  })
})
