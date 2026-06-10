import { summarizeDocProgress } from '@/lib/progress'
import { expect, test } from 'vitest'

test('percent par formation = documents vus / documents totaux, arrondi', () => {
  const s = summarizeDocProgress(
    [
      { formationId: 'a', total: 3 },
      { formationId: 'b', total: 4 },
    ],
    [
      { formationId: 'a', viewed: 1 },
      { formationId: 'b', viewed: 4 },
    ],
    8,
  )
  expect(s.percentByFormation.a).toBe(33)
  expect(s.percentByFormation.b).toBe(100)
  expect(s.total).toBe(8)
})

test('done = formations avec ≥ 1 document toutes vues', () => {
  const s = summarizeDocProgress(
    [
      { formationId: 'a', total: 2 },
      { formationId: 'b', total: 2 },
    ],
    [
      { formationId: 'a', viewed: 2 },
      { formationId: 'b', viewed: 1 },
    ],
    5,
  )
  expect(s.done).toBe(1)
  expect(s.percentByFormation.b).toBe(50)
})

test('formation sans document (SharePoint only) = 0 %, jamais terminée', () => {
  const s = summarizeDocProgress([], [], 3)
  expect(s.done).toBe(0)
  expect(s.total).toBe(3)
  expect(s.percentByFormation).toEqual({})
})

test('formation avec documents mais aucune vue → 0 %', () => {
  const s = summarizeDocProgress([{ formationId: 'a', total: 5 }], [], 1)
  expect(s.done).toBe(0)
  expect(s.percentByFormation.a).toBe(0)
})

test('viewed > total (docs supprimés depuis) → clampé à 100, terminée', () => {
  const s = summarizeDocProgress(
    [{ formationId: 'a', total: 2 }],
    [{ formationId: 'a', viewed: 3 }],
    1,
  )
  expect(s.percentByFormation.a).toBe(100)
  expect(s.done).toBe(1)
})

test('arrondi standard (2/3 → 67)', () => {
  const s = summarizeDocProgress(
    [{ formationId: 'a', total: 3 }],
    [{ formationId: 'a', viewed: 2 }],
    1,
  )
  expect(s.percentByFormation.a).toBe(67)
  expect(s.done).toBe(0)
})
