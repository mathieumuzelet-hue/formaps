/**
 * Pure helpers for the /admin/faq-gaps view: question normalization, grouping
 * with aggregates, and CSV export. No I/O — the admin router feeds rows in.
 */

import { BOM, DELIMITER, csvCell } from '@/lib/csv'

export type FaqGapRow = {
  query: string
  createdAt: Date
  retrievalScoreMax: number | null
  retrievalCount: number
  feedback: string | null
}

export type FaqGapGroup = {
  /** Raw text of the most recent occurrence. */
  question: string
  count: number
  lastAskedAt: Date
  /** Max score across the group; null when no occurrence had sources. */
  scoreMax: number | null
  /** Source count of the most recent occurrence. */
  retrievalCount: number
  dislikes: number
}

/** lowercase, collapse whitespace, strip trailing punctuation; keep accents. */
export function normalizeQuestion(query: string): string {
  return query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.…\s]+$/, '')
}

/** Groups rows by normalized question; sorted by count desc, then recency. */
export function groupFaqGaps(rows: FaqGapRow[]): FaqGapGroup[] {
  const byKey = new Map<string, FaqGapGroup>()

  for (const r of rows) {
    const key = normalizeQuestion(r.query)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        question: r.query,
        count: 1,
        lastAskedAt: r.createdAt,
        scoreMax: r.retrievalScoreMax,
        retrievalCount: r.retrievalCount,
        dislikes: r.feedback === 'dislike' ? 1 : 0,
      })
      continue
    }
    existing.count += 1
    if (r.feedback === 'dislike') existing.dislikes += 1
    if (r.retrievalScoreMax !== null) {
      existing.scoreMax =
        existing.scoreMax === null ? r.retrievalScoreMax : Math.max(existing.scoreMax, r.retrievalScoreMax)
    }
    if (r.createdAt > existing.lastAskedAt) {
      existing.lastAskedAt = r.createdAt
      existing.question = r.query
      existing.retrievalCount = r.retrievalCount
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || b.lastAskedAt.getTime() - a.lastAskedAt.getTime(),
  )
}

/** CSV `;` + BOM (Excel) ; cellules passées par csvCell (quoting RFC 4180 +
 *  guard formule — les questions viennent des salariés, contenu cross-user). */
export function buildFaqGapsCsv(groups: FaqGapGroup[]): string {
  const lines = ['question;occurrences;derniere_date;score_max;nb_sources;dislikes']
  for (const g of groups) {
    const date = g.lastAskedAt.toISOString().slice(0, 10)
    const score = g.scoreMax === null ? '' : g.scoreMax.toFixed(2)
    lines.push(
      [csvCell(g.question), g.count, date, score, g.retrievalCount, g.dislikes].join(DELIMITER),
    )
  }
  return BOM + lines.join('\n')
}
