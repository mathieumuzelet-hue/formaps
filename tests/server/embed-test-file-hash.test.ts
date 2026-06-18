import { describe, expect, test } from 'vitest'
import { hashBuffer } from '@/server/embed-test/file-hash'

describe('hashBuffer', () => {
  test('stable hex digest for identical bytes', () => {
    const a = hashBuffer(new Uint8Array([1, 2, 3]))
    const b = hashBuffer(new Uint8Array([1, 2, 3]))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  test('different bytes → different digest', () => {
    expect(hashBuffer(new Uint8Array([1]))).not.toBe(hashBuffer(new Uint8Array([2])))
  })
})
