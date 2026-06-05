import { expect, test } from 'vitest'

import { normalizeQuestion, groupFaqGaps, buildFaqGapsCsv, type FaqGapRow } from '@/lib/admin/faq-gaps'

test('normalizeQuestion : casse, espaces, ponctuation finale ; accents conservés', () => {
  expect(normalizeQuestion('  Comment  paramétrer une caisse Mercalys ?? ')).toBe(
    'comment paramétrer une caisse mercalys',
  )
  expect(normalizeQuestion('Étapes de clôture…')).toBe('étapes de clôture')
})

const row = (over: Partial<FaqGapRow>): FaqGapRow => ({
  query: 'q',
  createdAt: new Date('2026-06-01T10:00:00Z'),
  retrievalScoreMax: null,
  retrievalCount: 0,
  feedback: null,
  ...over,
})

test('groupFaqGaps : regroupe par question normalisée, agrégats corrects', () => {
  const rows = [
    row({ query: 'Caisse Mercalys ?', createdAt: new Date('2026-06-03T10:00:00Z'), retrievalScoreMax: 0.4, retrievalCount: 2 }),
    row({ query: 'caisse mercalys', createdAt: new Date('2026-06-01T10:00:00Z'), retrievalScoreMax: 0.2, retrievalCount: 1, feedback: 'dislike' }),
    row({ query: 'Clôture comptable ?', createdAt: new Date('2026-06-02T10:00:00Z') }),
  ]

  const groups = groupFaqGaps(rows)

  expect(groups).toHaveLength(2)
  // Tri par fréquence desc : le groupe Mercalys (2 occurrences) d'abord.
  expect(groups[0]).toEqual({
    question: 'Caisse Mercalys ?', // exemplaire le plus récent
    count: 2,
    lastAskedAt: new Date('2026-06-03T10:00:00Z'),
    scoreMax: 0.4, // max du groupe
    retrievalCount: 2, // de la dernière occurrence
    dislikes: 1,
  })
  expect(groups[1].question).toBe('Clôture comptable ?')
  expect(groups[1].scoreMax).toBeNull()
})

test('groupFaqGaps : à fréquence égale, le plus récent en premier', () => {
  const groups = groupFaqGaps([
    row({ query: 'ancienne', createdAt: new Date('2026-06-01T10:00:00Z') }),
    row({ query: 'récente', createdAt: new Date('2026-06-04T10:00:00Z') }),
  ])
  expect(groups.map((g) => g.question)).toEqual(['récente', 'ancienne'])
})

test('buildFaqGapsCsv : BOM + en-tête + lignes ; score vide si null', () => {
  const csv = buildFaqGapsCsv([
    { question: 'Caisse ?', count: 2, lastAskedAt: new Date('2026-06-03T10:00:00Z'), scoreMax: 0.4, retrievalCount: 2, dislikes: 1 },
    { question: 'Clôture ?', count: 1, lastAskedAt: new Date('2026-06-02T10:00:00Z'), scoreMax: null, retrievalCount: 0, dislikes: 0 },
  ])

  const lines = csv.split('\n')
  expect(lines[0].endsWith('question;occurrences;derniere_date;score_max;nb_sources;dislikes')).toBe(true)
  expect(lines[1]).toBe('Caisse ?;2;2026-06-03;0.40;2;1')
  expect(lines[2]).toBe('Clôture ?;1;2026-06-02;;0;0')
})
