import { describe, expect, it } from 'vitest'

import { normalizeEmail } from '@/lib/email'

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(normalizeEmail('Camille@APS.fr')).toBe('camille@aps.fr')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  camille@aps.fr ')).toBe('camille@aps.fr')
  })

  it('leaves an already-normalized address unchanged', () => {
    expect(normalizeEmail('camille@aps.fr')).toBe('camille@aps.fr')
  })
})
