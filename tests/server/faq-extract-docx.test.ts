import { beforeEach, expect, test, vi } from 'vitest'

const extractRawText = vi.hoisted(() => vi.fn())
vi.mock('mammoth', () => ({ default: { extractRawText } }))

import { DocxUnreadableError, extractDocxText } from '@/server/faq/extract-docx'

beforeEach(() => {
  extractRawText.mockReset()
})

test('retourne le texte brut extrait par mammoth', async () => {
  extractRawText.mockResolvedValue({ value: 'Bonjour le texte', messages: [] })
  await expect(extractDocxText(new Uint8Array([1, 2]))).resolves.toBe('Bonjour le texte')
  expect(extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) })
})

test('un échec mammoth devient DocxUnreadableError', async () => {
  extractRawText.mockRejectedValue(new Error('corrupt zip'))
  await expect(extractDocxText(new Uint8Array([1, 2]))).rejects.toBeInstanceOf(
    DocxUnreadableError,
  )
})
