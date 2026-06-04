import { summarizeProgress } from '@/lib/progress'
import { expect, test } from 'vitest'

test('compte les formations terminées', () => {
  const rows = [
    { formationId: 'a', status: 'done', progressPercent: 100 },
    { formationId: 'b', status: 'in_progress', progressPercent: 30 },
    { formationId: 'c', status: 'done', progressPercent: 100 },
  ] as const
  const s = summarizeProgress(rows, 8)
  expect(s.done).toBe(2)
  expect(s.total).toBe(8)
  expect(s.percentByFormation.b).toBe(30)
})
test('liste vide → 0 terminées', () => {
  const s = summarizeProgress([], 8)
  expect(s.done).toBe(0)
  expect(s.total).toBe(8)
})
