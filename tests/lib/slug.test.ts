import { slugify } from '@/lib/slug'
import { expect, test } from 'vitest'

test('slugify', () => {
  expect(slugify('Relation client')).toBe('relation-client')
  expect(slugify('RH & Paie')).toBe('rh-paie')
  expect(slugify('Sécurité & Hygiène')).toBe('securite-hygiene')
  expect(slugify('  Mercalys  ')).toBe('mercalys')
})
