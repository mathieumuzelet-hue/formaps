import { COLORS, STAGES } from '@/lib/design/tokens'
import { expect, test } from 'vitest'
test('charte FormA+Super (avril 2026)', () => {
  expect(COLORS.red).toBe('#E0001A')
  expect(COLORS.ink).toBe('#511227')
  expect(COLORS.violine).toBe('#511227')
  expect(COLORS.bg).toBe('#FFFAEF')
  expect(COLORS.coral).toBe('#FF6A78')
})
test('parcours = 5 étapes', () => { expect(STAGES).toHaveLength(5) })
