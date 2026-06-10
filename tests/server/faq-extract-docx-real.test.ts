import { expect, test } from 'vitest'

import { DocxUnreadableError, extractDocxText } from '@/server/faq/extract-docx'

// Real mammoth (no mock): garbage bytes must surface as DocxUnreadableError.
test('octets invalides → DocxUnreadableError avec le vrai mammoth', async () => {
  await expect(
    extractDocxText(new TextEncoder().encode('not a docx')),
  ).rejects.toBeInstanceOf(DocxUnreadableError)
})
