import { formatFileSize } from '@/lib/format-size'
import { expect, test } from 'vitest'

test('format size FR', () => {
  expect(formatFileSize(512)).toBe('512 o')
  expect(formatFileSize(870 * 1024)).toBe('870,0 Ko')
  expect(formatFileSize(Math.round(2.4 * 1024 * 1024))).toBe('2,4 Mo')
})
