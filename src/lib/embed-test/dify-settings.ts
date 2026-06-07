/**
 * Renders the winning config as copy-paste text in Dify UI vocabulary.
 * Deterministic (built in code, not by Claude) so the recommendation always
 * maps 1:1 to the knobs the admin sets manually in Dify.
 */
import { escapeSeparator } from '@/lib/embed-test/chunker'
import type { ChunkConfig, OcrVerdict } from '@/lib/embed-test/types'

function ouiNon(v: boolean): string {
  return v ? 'oui' : 'non'
}

export function formatDifySettings(config: ChunkConfig, ocr: OcrVerdict): string {
  const lines: string[] = []
  if (config.mode === 'general') {
    lines.push('Mode : Général')
    lines.push(`Délimiteur : ${escapeSeparator(config.separator)}`)
    lines.push(`Longueur max : ${config.maxTokens} tokens`)
    lines.push(`Chevauchement : ${config.overlapTokens} tokens`)
  } else {
    lines.push('Mode : Parent-enfant')
    lines.push(`Délimiteur : ${escapeSeparator(config.separator)}`)
    lines.push(`Parent : ${config.parentMaxTokens} tokens`)
    lines.push(`Enfant : ${config.childMaxTokens} tokens`)
  }
  lines.push(
    `Prétraitement — Remplacer les espaces consécutifs : ${ouiNon(config.preprocessing.removeExtraSpaces)}`,
  )
  lines.push(
    `Prétraitement — Supprimer URLs et e-mails : ${ouiNon(config.preprocessing.removeUrlsEmails)}`,
  )
  lines.push(
    ocr.verdict === 'ocr_needed'
      ? 'Pipeline : ACTIVEZ le pipeline OCR (couche texte non fiable)'
      : 'Pipeline : extraction texte (OCR inutile)',
  )
  return lines.join('\n')
}
