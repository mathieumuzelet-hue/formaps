import { expect, test } from 'vitest'

import { stepOptions } from '@/lib/admin/store-step-options'

test('stepOptions renvoie une option par étape', () => {
  expect(stepOptions()).toHaveLength(5)
})

test('stepOptions formate "index · libellé" depuis STAGES', () => {
  const options = stepOptions()
  expect(options[0]).toEqual({ value: 0, label: '0 · Préparation' })
  expect(options[1].label).toBe('1 · Formation')
  expect(options[4].label).toBe('4 · Ouverture')
})
