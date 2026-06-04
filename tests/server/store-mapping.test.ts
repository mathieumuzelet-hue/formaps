import { toStoreView } from '@/lib/store-view'
import { expect, test } from 'vitest'

test('mappe un magasin en vue avec J-N et étape', () => {
  const v = toStoreView(
    { id: 's1', name: 'Magasin de Lille', basculeDate: '2026-06-22', currentStep: 1 },
    new Date('2026-06-04T10:00:00Z'),
  )
  expect(v.joursRestants).toBe(18)
  expect(v.parcoursPercent).toBe(25)
  expect(v.currentStepLabel).toBe('Formation')
})
