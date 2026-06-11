// tests/server/purge-chat-queries.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_RETENTION_MONTHS,
  PURGE_INTERVAL_MS,
  purgeChatQueries,
  retentionCutoff,
  retentionMonths,
} from '@/server/jobs/purge-chat-queries'

describe('retentionMonths', () => {
  it('defaults to 12 when the env is unset', () => {
    expect(retentionMonths(undefined)).toBe(DEFAULT_RETENTION_MONTHS)
    expect(DEFAULT_RETENTION_MONTHS).toBe(12)
  })

  it('parses a valid integer', () => {
    expect(retentionMonths('6')).toBe(6)
  })

  it('falls back to 12 on invalid values (warn, never throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(retentionMonths('abc')).toBe(12)
    expect(retentionMonths('0')).toBe(12)
    expect(retentionMonths('-3')).toBe(12)
    expect(retentionMonths('2.5')).toBe(12)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('retentionCutoff', () => {
  it('subtracts N months from now', () => {
    const now = new Date('2026-06-11T10:00:00Z')
    expect(retentionCutoff(12, now).toISOString()).toBe('2025-06-11T10:00:00.000Z')
  })
})

describe('purgeChatQueries', () => {
  function mockDb(returned: Array<{ id: string }>) {
    const returning = vi.fn().mockResolvedValue(returned)
    const where = vi.fn(() => ({ returning }))
    const del = vi.fn(() => ({ where }))
    return { db: { delete: del } as never, del, where }
  }

  it('deletes rows older than the cutoff and returns the count', async () => {
    const { db, del } = mockDb([{ id: 'a' }, { id: 'b' }])
    const n = await purgeChatQueries(db, 12)
    expect(n).toBe(2)
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when nothing matched', async () => {
    const { db } = mockDb([])
    expect(await purgeChatQueries(db, 12)).toBe(0)
  })
})

describe('startChatQueriesPurgeJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at boot, re-runs every 24h, and never throws on db error', async () => {
    // Fresh module instance so the `started` latch is clean.
    const { startChatQueriesPurgeJob } = await import('@/server/jobs/purge-chat-queries')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const returning = vi.fn().mockRejectedValue(new Error('db down'))
    const db = { delete: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) } as never

    startChatQueriesPurgeJob(db)
    // Flush the boot run microtasks WITHOUT firing the pending 24h interval
    // (runOnlyPendingTimersAsync would fire it and double-count the boot run).
    await vi.advanceTimersByTimeAsync(0)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled() // logged, not thrown

    await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS)
    expect(returning).toHaveBeenCalledTimes(2)

    // Idempotent: a second start does not double the schedule.
    startChatQueriesPurgeJob(db)
    await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS)
    expect(returning).toHaveBeenCalledTimes(3)
    error.mockRestore()
  })
})
