import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { createQaDocument, deleteDocument } = vi.hoisted(() => ({
  createQaDocument: vi.fn(),
  deleteDocument: vi.fn(),
}))
vi.mock('@/server/dify/knowledge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createQaDocument,
  deleteDocument,
}))
const { upsertSync, getSyncRow } = vi.hoisted(() => ({ upsertSync: vi.fn(), getSyncRow: vi.fn() }))
vi.mock('@/server/dify/sync-store', () => ({ upsertSync, getSyncRow }))

const selectWhere = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbMock = { select: vi.fn(() => ({ from: selectFrom })) } as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)
const DRAFT_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'
function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: { user: { id: 'a', role, storeId: null, firstName: 'A', email: 'a@b.fr' }, expires: '' },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DIFY_QA_DATASET_ID = 'qa-ds'
  process.env.DIFY_API_URL = 'https://d/v1'
  process.env.DIFY_DATASET_API_KEY = 'k'
  getSyncRow.mockResolvedValue(null)
})

test('pushFaq pushes segments and upserts synced', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'faq.pdf', items: [{ id: 'i1', question: 'Q', answer: 'R', origin: 'generated' }] },
  ])
  createQaDocument.mockResolvedValue({ documentId: 'doc-1' })
  const out = await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(out).toEqual({ documentId: 'doc-1' })
  expect(createQaDocument).toHaveBeenCalledWith(
    expect.objectContaining({ datasetId: 'qa-ds', name: 'faq.pdf', segments: [{ content: 'Q', answer: 'R' }] }),
  )
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sourceType: 'faq_draft', sourceId: DRAFT_ID, status: 'synced', difyDocumentId: 'doc-1' }),
  )
})

test('pushFaq re-push deletes the previous document first', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceFilename: 'f.pdf', items: [] }])
  getSyncRow.mockResolvedValue({ difyDocumentId: 'old-doc', datasetId: 'qa-ds' })
  createQaDocument.mockResolvedValue({ documentId: 'new-doc' })
  await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(deleteDocument).toHaveBeenCalledWith(expect.objectContaining({ datasetId: 'qa-ds', documentId: 'old-doc' }))
})

test('pushFaq on client failure upserts failed and rethrows', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceFilename: 'f.pdf', items: [] }])
  createQaDocument.mockRejectedValue(new Error('boom'))
  await expect(caller().difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toThrow()
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') }),
  )
})

test('pushFaq without DIFY_QA_DATASET_ID → PRECONDITION_FAILED', async () => {
  delete process.env.DIFY_QA_DATASET_ID
  await expect(caller().difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

test('non-admin → FORBIDDEN', async () => {
  await expect(caller('employee').difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
