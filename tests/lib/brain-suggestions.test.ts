import { expect, test } from 'vitest'

import { BRAIN_SUGGESTIONS, resolveSuggestions } from '@/lib/brain/suggestions'

test('retourne les suggestions DB quand il y en a', () => {
  const fromDb = ['Question A ?', 'Question B ?']
  expect(resolveSuggestions(fromDb)).toEqual(fromDb)
})

test('liste vide → fallback sur les suggestions hardcodées', () => {
  expect(resolveSuggestions([])).toEqual(BRAIN_SUGGESTIONS)
  expect(BRAIN_SUGGESTIONS.length).toBeGreaterThan(0)
})
