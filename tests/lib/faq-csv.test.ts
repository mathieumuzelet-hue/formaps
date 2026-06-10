import { expect, test } from 'vitest'

import { buildFaqCsv } from '@/lib/admin/faq-csv'

test('en-tête question,answer + une ligne par paire, CRLF', () => {
  const csv = buildFaqCsv([{ question: 'Q1 ?', answer: 'R1.' }])
  expect(csv).toBe('question,answer\r\nQ1 ?,R1.\r\n')
})

test('RFC 4180 : virgule, guillemets et retours ligne → champ quoté, " doublé', () => {
  const csv = buildFaqCsv([
    { question: 'Avant, après ?', answer: 'Dit "oui"\nsur deux lignes' },
  ])
  expect(csv).toBe('question,answer\r\n"Avant, après ?","Dit ""oui""\nsur deux lignes"\r\n')
})

test('pas de garde anti-formule : un = de tête reste intact (ingestion Dify, pas Excel)', () => {
  const csv = buildFaqCsv([{ question: '=A1 ?', answer: '=somme' }])
  expect(csv).toContain('=A1 ?,=somme')
})
