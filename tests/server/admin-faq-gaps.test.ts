import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const selectOrderBy = vi.fn()
const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }))
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
