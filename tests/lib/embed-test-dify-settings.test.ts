import { describe, expect, test } from 'vitest'

import { formatDifySettings } from '@/lib/embed-test/dify-settings'
import type { ChunkConfig, OcrVerdict } from '@/lib/embed-test/types'

const config: ChunkConfig = {
  label: 'Standard',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}
const ocrOk: OcrVerdict = { verdict: 'text_ok', reason: 'fidèle', coverage: 0.98 }

describe('formatDifySettings', () => {
  test('general mode in Dify UI vocabulary', () => {
    const out = formatDifySettings(config, ocrOk)
    expect(out).toContain('Mode : Général')
    expect(out).toContain('Délimiteur : \\n\\n')
    expect(out).toContain('Longueur max : 1024 tokens')
    expect(out).toContain('Chevauchement : 128 tokens')
    expect(out).toContain('Remplacer les espaces consécutifs : oui')
    expect(out).toContain('Supprimer URLs et e-mails : non')
    expect(out).toContain('Pipeline : extraction texte (OCR inutile)')
  })

  test('parent-child mode + OCR needed', () => {
    const out = formatDifySettings(
      { ...config, mode: 'parent-child', parentMaxTokens: 2000, childMaxTokens: 400 },
      { verdict: 'ocr_needed', reason: 'scanné', coverage: 0.1 },
    )
    expect(out).toContain('Mode : Parent-enfant')
    expect(out).toContain('Parent : 2000 tokens')
    expect(out).toContain('Enfant : 400 tokens')
    expect(out).toContain('Pipeline : ACTIVEZ le pipeline OCR')
  })
})
