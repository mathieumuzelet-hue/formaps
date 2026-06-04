import { generatePassword } from '@/server/auth/generate-password'
import { expect, test } from 'vitest'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

test('respects requested length (default 12)', () => {
  expect(generatePassword()).toHaveLength(12)
  expect(generatePassword(20)).toHaveLength(20)
})

test('only uses the unambiguous charset (no 0/O/1/l/I)', () => {
  for (let i = 0; i < 50; i++) {
    const pw = generatePassword(16)
    for (const ch of pw) {
      expect(CHARSET).toContain(ch)
    }
  }
})

test('two calls differ', () => {
  expect(generatePassword()).not.toBe(generatePassword())
})
