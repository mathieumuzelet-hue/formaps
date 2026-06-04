import { COLORS, STAGES } from '@/lib/design/tokens'
import { expect, test } from 'vitest'
test('tokens couleurs Direction B', () => {
  expect(COLORS.red).toBe('#C8102E')
  expect(COLORS.bg).toBe('#F4EEE3')
})
test('parcours = 5 étapes', () => { expect(STAGES).toHaveLength(5) })
