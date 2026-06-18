import { describe, expect, test } from 'vitest'
import { isPdf, isZip } from '@/lib/upload/magic-bytes'

describe('isPdf', () => {
  test('true on %PDF signature', () => {
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true)
  })
  test('false on non-PDF bytes', () => {
    expect(isPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
  })
  test('false on buffer too short', () => {
    expect(isPdf(new Uint8Array([0x25, 0x50]))).toBe(false)
  })
})

describe('isZip', () => {
  test('true on PK\\x03\\x04 signature', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  })
  test('false on PDF bytes', () => {
    expect(isZip(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false)
  })
})
