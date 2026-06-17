import { describe, expect, test, vi } from 'vitest'
import { upsertSync, getSyncRow } from '@/server/dify/sync-store'

function mockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn((_row: Record<string, unknown>) => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  const where = vi.fn().mockResolvedValue([{ difyDocumentId: 'd1', datasetId: 'ds' }])
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { db: { insert, select } as never, insert, values, onConflictDoUpdate, select, from, where }
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
})
