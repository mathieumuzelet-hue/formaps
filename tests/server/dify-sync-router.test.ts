import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { createQaCsvDocument, updateQaCsvDocument, deleteDocument, createDocumentByFile, updateDocumentByFile } = vi.hoisted(() => ({
  createQaCsvDocument: vi.fn(),
  updateQaCsvDocument: vi.fn(),
  deleteDocument: vi.fn(),
  createDocumentByFile: vi.fn(),
  updateDocumentByFile: vi.fn(),
}))
vi.mock('@/server/dify/knowledge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createQaCsvDocument,
  updateQaCsvDocument,
  deleteDocument,
  createDocumentByFile,
  updateDocumentByFile,
}))
const { upsertSync, getSyncRow, removeSyncedDocument } = vi.hoisted(() => ({
  upsertSync: vi.fn(),
  getSyncRow: vi.fn(),
  removeSyncedDocument: vi.fn(),
}))
vi.mock('@/server/dify/sync-store', () => ({ upsertSync, getSyncRow, removeSyncedDocument }))
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { readFile }, readFile }))

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

test('pushFaq uploads a Q&A CSV via create-by-file and upserts synced', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'faq.pdf', items: [{ id: 'i1', question: 'Q', answer: 'R', origin: 'generated' }] },
  ])
  createQaCsvDocument.mockResolvedValue({ documentId: 'doc-1' })
  const out = await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(out).toEqual({ documentId: 'doc-1' })
  const arg = createQaCsvDocument.mock.calls[0][0]
  expect(arg.datasetId).toBe('qa-ds')
  expect(arg.name).toBe('faq.csv') // extension normalisée en .csv
  expect(arg.csv).toContain('question,answer')
  expect(arg.csv).toContain('Q,R')
  expect(updateQaCsvDocument).not.toHaveBeenCalled()
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sourceType: 'faq_draft', sourceId: DRAFT_ID, status: 'synced', difyDocumentId: 'doc-1' }),
  )
})

test('pushFaq re-push updates the existing document via update-by-file', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'f.pdf', items: [{ id: 'i1', question: 'Q', answer: 'R', origin: 'generated' }] },
  ])
  getSyncRow.mockResolvedValue({ difyDocumentId: 'old-doc', datasetId: 'qa-ds' })
  await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(updateQaCsvDocument).toHaveBeenCalledWith(
    expect.objectContaining({ datasetId: 'qa-ds', documentId: 'old-doc', name: 'f.csv' }),
  )
  expect(createQaCsvDocument).not.toHaveBeenCalled()
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: 'synced', difyDocumentId: 'old-doc' }),
  )
})

test('pushFaq on client failure upserts failed and rethrows', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceFilename: 'f.pdf', items: [] }])
  createQaCsvDocument.mockRejectedValue(new Error('boom'))
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

test('pushFormationDoc creates a file document and upserts synced', async () => {
  process.env.DIFY_DOCS_DATASET_ID = 'docs-ds'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, title: 'Cours' }]) // formationDocuments row
  readFile.mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46]))
  createDocumentByFile.mockResolvedValue({ documentId: 'fdoc-1' })
  getSyncRow.mockResolvedValue(null)
  const out = await caller().difySync.pushFormationDoc({ docId: DRAFT_ID })
  expect(out).toEqual({ documentId: 'fdoc-1' })
  expect(createDocumentByFile).toHaveBeenCalledWith(
    expect.objectContaining({ datasetId: 'docs-ds', name: expect.stringContaining('Cours') }),
  )
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sourceType: 'formation_doc', status: 'synced', difyDocumentId: 'fdoc-1' }),
  )
})

test('pushFormationDoc re-push uses updateDocumentByFile', async () => {
  process.env.DIFY_DOCS_DATASET_ID = 'docs-ds'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, title: 'Cours' }])
  readFile.mockResolvedValue(Buffer.from([0x25]))
  getSyncRow.mockResolvedValue({ difyDocumentId: 'old-fdoc', datasetId: 'docs-ds' })
  await caller().difySync.pushFormationDoc({ docId: DRAFT_ID })
  expect(updateDocumentByFile).toHaveBeenCalledWith(
    expect.objectContaining({ documentId: 'old-fdoc', datasetId: 'docs-ds' }),
  )
  expect(createDocumentByFile).not.toHaveBeenCalled()
})

test('unsync delegates to removeSyncedDocument and returns ok', async () => {
  const out = await caller().difySync.unsync({ sourceType: 'faq_draft', sourceId: DRAFT_ID })
  expect(out).toEqual({ ok: true })
  expect(removeSyncedDocument).toHaveBeenCalledWith(expect.anything(), 'faq_draft', DRAFT_ID)
})

test('non-admin → FORBIDDEN', async () => {
  await expect(caller('employee').difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
