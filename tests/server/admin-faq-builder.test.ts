import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { generateMorePairs } = vi.hoisted(() => ({ generateMorePairs: vi.fn() }))
vi.mock('@/server/faq/claude', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateMorePairs,
}))
vi.mock('@/server/claude-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAnthropicClient: vi.fn(() => ({})),
}))

const selectWhere = vi.fn()
const selectOrderBy = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere, orderBy: selectOrderBy }))
const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))
const deleteReturning = vi.fn()
const deleteWhere = vi.fn(() => ({ returning: deleteReturning }))
const dbMock = {
  select: vi.fn(() => ({ from: selectFrom })),
  update: vi.fn(() => ({ set: updateSet })),
  delete: vi.fn(() => ({ where: deleteWhere })),
} as never

import { ClaudeOutputTruncatedError } from '@/server/claude-core'
import { NoNewPairsError } from '@/server/faq/claude'
import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)
const DRAFT_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'
const ITEM = {
  id: '7f9619ff-8b86-4d01-b42d-00c04fc964ff',
  question: 'Q ?',
  answer: 'R.',
  origin: 'generated' as const,
}

function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: {
      user: { id: 'admin1', role, storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

test('list renvoie itemCount (compté en SQL) sans exposer sourceText', async () => {
  // Le mock ne peut pas exécuter le jsonb_array_length — on épingle le pass-through.
  selectOrderBy.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'a.pdf', itemCount: 2, updatedAt: new Date(0) },
  ])
  const rows = await caller().faqBuilder.list()
  expect(rows).toEqual([
    { id: DRAFT_ID, sourceFilename: 'a.pdf', itemCount: 2, updatedAt: new Date(0) },
  ])
})

test('get inconnu → NOT_FOUND ; non-admin → FORBIDDEN', async () => {
  selectWhere.mockResolvedValue([])
  await expect(caller().faqBuilder.get({ id: DRAFT_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  await expect(caller('employee').faqBuilder.list()).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
})

test('updateItems remplace la liste et bump updatedAt', async () => {
  updateReturning.mockResolvedValue([{ id: DRAFT_ID }])
  await caller().faqBuilder.updateItems({ id: DRAFT_ID, items: [ITEM] })
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({ items: [ITEM], updatedAt: expect.any(Date) }),
  )
})

test('updateItems rejette une paire vide (zod)', async () => {
  await expect(
    caller().faqBuilder.updateItems({ id: DRAFT_ID, items: [{ ...ITEM, question: '' }] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

test('generateMore ajoute en fin de liste avec origin generated', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceText: 'doc', items: [ITEM] },
  ])
  updateReturning.mockResolvedValue([{ id: DRAFT_ID }])
  generateMorePairs.mockResolvedValue({
    data: [{ question: 'Neuve ?', answer: 'Oui.' }],
    usage: { inputTokens: 1, outputTokens: 1 },
  })
  const res = await caller().faqBuilder.generateMore({ draftId: DRAFT_ID })
  expect(generateMorePairs).toHaveBeenCalledWith(expect.anything(), 'doc', ['Q ?'])
  expect(res.added).toBe(1)
  expect(res.items).toHaveLength(2)
  expect(res.items[1]).toMatchObject({ question: 'Neuve ?', origin: 'generated' })
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({ updatedAt: expect.any(Date) }),
  )
})

test('generateMore sans clé API → SERVICE_UNAVAILABLE ; échec Claude → BAD_GATEWAY', async () => {
  delete process.env.ANTHROPIC_API_KEY
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject(
    { code: 'SERVICE_UNAVAILABLE' },
  )
  process.env.ANTHROPIC_API_KEY = 'test-key'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceText: 'doc', items: [] }])
  generateMorePairs.mockRejectedValue(new Error('boom'))
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject(
    { code: 'BAD_GATEWAY', message: 'generation_failed' },
  )
})

test('generateMore : tout doublon (NoNewPairsError) → CONFLICT no_new_pairs', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceText: 'doc', items: [ITEM] }])
  generateMorePairs.mockRejectedValue(new NoNewPairsError())
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'no_new_pairs',
  })
})

test('generateMore : sortie tronquée → BAD_GATEWAY output_truncated', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceText: 'doc', items: [ITEM] }])
  generateMorePairs.mockRejectedValue(new ClaudeOutputTruncatedError())
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject({
    code: 'BAD_GATEWAY',
    message: 'output_truncated',
  })
})

test('generateMore : draft inconnu → NOT_FOUND', async () => {
  selectWhere.mockResolvedValue([])
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})

test('delete inconnu → NOT_FOUND', async () => {
  deleteReturning.mockResolvedValue([])
  await expect(caller().faqBuilder.delete({ id: DRAFT_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})
