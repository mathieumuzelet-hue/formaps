import { beforeEach, describe, expect, test, vi } from 'vitest'

const { deleteDocument } = vi.hoisted(() => ({ deleteDocument: vi.fn() }))
vi.mock('@/server/dify/knowledge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteDocument,
}))

import { upsertSync, getSyncRow, removeSyncedDocument } from '@/server/dify/sync-store'

function mockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn((_row: Record<string, unknown>) => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  const where = vi.fn().mockResolvedValue([{ difyDocumentId: 'd1', datasetId: 'ds' }])
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn(() => ({ where: deleteWhere }))
  return {
    db: { insert, select, delete: del } as never,
    insert, values, onConflictDoUpdate, select, from, where,
    delete: del, deleteWhere,
  }
}

describe('upsertSync', () => {
  test('inserts with synced status sets syncedAt and conflict-updates', async () => {
    const m = mockDb()
    await upsertSync(m.db, {
      sourceType: 'faq_draft', sourceId: 's1', datasetId: 'ds',
      difyDocumentId: 'doc1', status: 'synced',
    })
    expect(m.values).toHaveBeenCalledTimes(1)
    const row = m.values.mock.calls[0][0] as Record<string, unknown>
    expect(row.status).toBe('synced')
    expect(row.syncedAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
    expect(m.onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })
  test('failed status carries error and null syncedAt', async () => {
    const m = mockDb()
    await upsertSync(m.db, {
      sourceType: 'faq_draft', sourceId: 's1', datasetId: 'ds',
      difyDocumentId: null, status: 'failed', error: 'boom',
    })
    const row = m.values.mock.calls[0][0] as Record<string, unknown>
    expect(row.status).toBe('failed')
    expect(row.error).toBe('boom')
    expect(row.syncedAt).toBeNull()
  })
})

describe('getSyncRow', () => {
  test('returns the row when present', async () => {
    const m = mockDb()
    expect(await getSyncRow(m.db, 'faq_draft', 's1')).toEqual({ difyDocumentId: 'd1', datasetId: 'ds' })
  })
  test('returns null when no row matches', async () => {
    const m = mockDb()
    m.where.mockResolvedValue([])
    expect(await getSyncRow(m.db, 'faq_draft', 'missing')).toBeNull()
  })
})

describe('removeSyncedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes the Dify document then the dify_sync row when a synced row exists', async () => {
    const m = mockDb() // getSyncRow → { difyDocumentId: 'd1', datasetId: 'ds' }
    await removeSyncedDocument(m.db, 'faq_draft', 's1')
    expect(deleteDocument).toHaveBeenCalledWith({ datasetId: 'ds', documentId: 'd1' })
    expect(m.delete).toHaveBeenCalledTimes(1)
    expect(m.deleteWhere).toHaveBeenCalledTimes(1)
  })

  test('still deletes the row but skips Dify when no row / no difyDocumentId', async () => {
    const m = mockDb()
    m.where.mockResolvedValue([]) // getSyncRow → null
    await removeSyncedDocument(m.db, 'formation_doc', 'missing')
    expect(deleteDocument).not.toHaveBeenCalled()
    expect(m.delete).toHaveBeenCalledTimes(1)
    expect(m.deleteWhere).toHaveBeenCalledTimes(1)
  })

  test('swallows a Dify delete failure and still deletes the row', async () => {
    const m = mockDb()
    deleteDocument.mockRejectedValueOnce(new Error('dify down'))
    await expect(removeSyncedDocument(m.db, 'faq_draft', 's1')).resolves.toBeUndefined()
    expect(m.delete).toHaveBeenCalledTimes(1)
  })
})
