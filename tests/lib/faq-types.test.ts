import { expect, test } from 'vitest'

import { faqItemSchema } from '@/lib/faq/types'

const VALID = {
  id: '6f9619ff-8b86-4d01-b42d-00c04fc964ff',
  question: 'Quand mon magasin bascule-t-il ?',
  answer: 'La date J est fixée par magasin dans le Cockpit.',
  origin: 'generated',
}

test('faqItemSchema accepte une paire valide', () => {
  expect(faqItemSchema.parse(VALID)).toEqual(VALID)
})

test('faqItemSchema rejette question vide, réponse vide, origin inconnu, id non-uuid', () => {
  expect(faqItemSchema.safeParse({ ...VALID, question: '' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, answer: '   ' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, origin: 'imported' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, id: 'nope' }).success).toBe(false)
})
