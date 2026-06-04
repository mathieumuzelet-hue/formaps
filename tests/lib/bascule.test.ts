import { joursRestants, parcoursPercent } from '@/lib/bascule'
import { expect, test } from 'vitest'

test('joursRestants = différence en jours pleins', () => {
  const today = new Date('2026-06-04T10:00:00Z')
  expect(joursRestants('2026-06-22', today)).toBe(18)
})
test('joursRestants jamais négatif (jour J ou passé → 0)', () => {
  const today = new Date('2026-06-25T10:00:00Z')
  expect(joursRestants('2026-06-22', today)).toBe(0)
})
test('jour J même = 0', () => {
  const today = new Date('2026-06-22T23:00:00Z')
  expect(joursRestants('2026-06-22', today)).toBe(0)
})
test('parcoursPercent = currentStep / 4', () => {
  expect(parcoursPercent(0)).toBe(0)
  expect(parcoursPercent(1)).toBe(25)
  expect(parcoursPercent(4)).toBe(100)
})
test('parcoursPercent borne les valeurs hors plage', () => {
  expect(parcoursPercent(-2)).toBe(0)
  expect(parcoursPercent(9)).toBe(100)
})
