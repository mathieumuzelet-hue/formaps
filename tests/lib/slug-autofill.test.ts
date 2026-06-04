import { nextSlug } from '@/lib/slug'
import { expect, test } from 'vitest'

test('nextSlug auto-fills from name while untouched', () => {
  expect(nextSlug('Relation client', false, '')).toBe('relation-client')
  expect(nextSlug('Sécurité & Hygiène', false, 'stale')).toBe('securite-hygiene')
})

test('nextSlug keeps the manual slug once touched', () => {
  expect(nextSlug('Relation client', true, 'mon-slug')).toBe('mon-slug')
  expect(nextSlug('Relation client', true, '')).toBe('')
})
