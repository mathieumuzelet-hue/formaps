// src/lib/embed-test/diagnostics.ts
/**
 * Deterministic structure analysis of the extracted PDF text. Explains WHY
 * chunking scores plateau (no paragraph breaks, table-like lines, …) and
 * feeds the proposal prompt so Claude picks fitting separators. Pure module.
 */
import { countTokens } from '@/lib/embed-test/chunker'
import type { TextDiagnostic } from '@/lib/embed-test/types'

const SHORT_LINE_CHARS = 40
const LONG_PARAGRAPH_TOKENS = 500
const SHORT_LINE_RATIO_LIMIT = 0.5

export function analyzeTextStructure(text: string): TextDiagnostic {
  const totalChars = text.length
  const paragraphBreaks = (text.match(/\n{2,}/g) ?? []).length
  const lineBreaks = (text.match(/(?<!\n)\n(?!\n)/g) ?? []).length

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const avgParagraphTokens =
    paragraphs.length === 0
      ? 0
      : Math.round(
          paragraphs.reduce((sum, p) => sum + countTokens(p), 0) / paragraphs.length,
        )
  const shortLineRatio =
    lines.length === 0
      ? 0
      : lines.filter((l) => l.length < SHORT_LINE_CHARS).length / lines.length

  const notes: string[] = []
  if (paragraphBreaks === 0) {
    notes.push(
      'Aucun saut de paragraphe (\\n\\n) détecté — les séparateurs paragraphe ne ' +
        'matcheront jamais, préférez \\n ou un découpage par phrases.',
    )
  }
  if (avgParagraphTokens > LONG_PARAGRAPH_TOKENS) {
    notes.push(
      `Paragraphes très longs (~${avgParagraphTokens} tokens en moyenne) — ils ` +
        'seront re-découpés brutalement par tokens.',
    )
  }
  if (shortLineRatio > SHORT_LINE_RATIO_LIMIT) {
    notes.push(
      'Majorité de lignes courtes — texte probablement issu d’un tableau ou ' +
        'd’une mise en page colonne, structure peu fiable.',
    )
  }

  let verdict: TextDiagnostic['verdict']
  if (paragraphBreaks === 0) {
    verdict = 'flat'
  } else if (
    avgParagraphTokens > LONG_PARAGRAPH_TOKENS ||
    shortLineRatio > SHORT_LINE_RATIO_LIMIT
  ) {
    verdict = 'weakly_structured'
  } else {
    verdict = 'structured'
  }
  if (verdict === 'structured') {
    notes.push('Texte bien structuré — les séparateurs paragraphe devraient fonctionner.')
  }

  return {
    totalChars,
    paragraphBreaks,
    lineBreaks,
    avgParagraphTokens,
    shortLineRatio,
    verdict,
    notes,
  }
}

const VERDICT_LABELS: Record<TextDiagnostic['verdict'], string> = {
  structured: 'texte bien structuré',
  weakly_structured: 'texte peu structuré',
  flat: 'texte plat (aucune structure de paragraphe)',
}

/** Compact French rendering for the proposal prompt. */
export function diagnosticPromptSummary(d: TextDiagnostic): string {
  return [
    `Verdict : ${VERDICT_LABELS[d.verdict]}.`,
    `Métriques : ${d.paragraphBreaks} sauts de paragraphe, ` +
      `~${d.avgParagraphTokens} tokens/paragraphe, ` +
      `${Math.round(d.shortLineRatio * 100)} % de lignes courtes, ` +
      `${d.totalChars} caractères.`,
    ...d.notes.map((n) => `- ${n}`),
  ].join('\n')
}
