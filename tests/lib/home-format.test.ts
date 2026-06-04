import { joursLabel } from '@/lib/home-format'
import { expect, test } from 'vitest'

test('pluriel pour plusieurs jours', () => {
  expect(joursLabel(18)).toBe('18 jours')
})

test('singulier pour un jour', () => {
  expect(joursLabel(1)).toBe('1 jour')
})

test("zéro jour → aujourd'hui", () => {
  expect(joursLabel(0)).toBe("aujourd'hui")
})

test('jours négatifs traités comme aujourd\'hui', () => {
  expect(joursLabel(-3)).toBe("aujourd'hui")
})
