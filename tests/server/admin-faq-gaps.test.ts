import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const selectOrderBy = vi.fn()
const selectWhere = vi.fn((_where: unknown) => ({ orderBy: selectOrderBy }))
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbSelect = vi.fn(() => ({ from: selectFrom }))
const dbMock = { select: dbSelect } as never

import { faqGapsRouter } from '@/server/trpc/routers/admin-faq-gaps'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(faqGapsRouter)

function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: {
      user: { id: 'u1', role, storeId: null, firstName: 'Admin', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectOrderBy.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('non-admin → FORBIDDEN', async () => {
  await expect(caller('employee').list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('regroupe les lignes retournées par la DB', async () => {
  selectOrderBy.mockResolvedValue([
    {
      query: 'Caisse Mercalys ?',
      createdAt: new Date('2026-06-03T10:00:00Z'),
      retrievalScoreMax: 0.4,
      retrievalCount: 2,
      feedback: null,
    },
    {
      query: 'caisse mercalys',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      retrievalScoreMax: null,
      retrievalCount: 0,
      feedback: 'dislike',
    },
  ])

  const groups = await caller().list()

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ question: 'Caisse Mercalys ?', count: 2, dislikes: 1 })
})

test('seuil appliqué à la lecture : FAQ_RELEVANCE_THRESHOLD rétroactif, hasRelevantSource ignoré', async () => {
  // Insérée quand le seuil valait 0.5 : retrievalScoreMax 0.6, hasRelevantSource true.
  // Avec FAQ_RELEVANCE_THRESHOLD=0.7 elle DOIT matcher le filtre (score < 0.7),
  // et une ligne à 0.8 ne doit pas matcher — donc la clause compare le score
  // stocké au seuil COURANT et n'interroge plus le cache d'insert.
  vi.stubEnv('FAQ_RELEVANCE_THRESHOLD', '0.7')

  await caller().list()

  const where = selectWhere.mock.calls[0]?.[0] as SQL
  const { sql, params } = new PgDialect().sqlToQuery(where)

  expect(sql).toContain('"retrieval_score_max" is null')
  expect(sql).toContain('"retrieval_score_max" <')
  expect(params).toContain(0.7)
  expect(params).toContain('dislike')
  expect(sql).not.toContain('has_relevant_source')
})
