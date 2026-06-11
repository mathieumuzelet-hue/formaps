import { expect, test, vi } from 'vitest'

import { isTokenStale, validatePasswordFreshness } from '@/server/auth/token-validation'

// --- isTokenStale (pur) ---------------------------------------------------

test('claim absent (vieux token pré-déploiement) → stale', () => {
  expect(isTokenStale(undefined, new Date('2026-06-01T10:00:00Z'))).toBe(true)
})

test('user introuvable (dbValue null) → stale', () => {
  expect(isTokenStale(1764583200000, null)).toBe(true)
})

test('claim égal à la DB → fresh', () => {
  const d = new Date('2026-06-01T10:00:00Z')
  expect(isTokenStale(d.getTime(), d)).toBe(false)
})

test('claim différent (mot de passe changé depuis) → stale', () => {
  const issued = new Date('2026-06-01T10:00:00Z')
  const changed = new Date('2026-06-02T08:00:00Z')
  expect(isTokenStale(issued.getTime(), changed)).toBe(true)
})

// --- validatePasswordFreshness (db injectée) ------------------------------

type DbRow = {
  passwordChangedAt: Date
  role: 'employee' | 'admin'
  storeId: string | null
}

function makeDb(result: Promise<Array<DbRow>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => result) })),
      })),
    })),
  } as never
}

const NOW = new Date('2026-06-01T10:00:00Z')

test('claim aligné sur la DB → fresh', async () => {
  const db = makeDb(Promise.resolve([{ passwordChangedAt: NOW, role: 'admin', storeId: null }]))
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toMatchObject({ status: 'fresh' })
})

test('fresh : les claims DB (role, storeId) accompagnent le statut', async () => {
  const db = makeDb(
    Promise.resolve([{ passwordChangedAt: NOW, role: 'admin', storeId: 'store-9' }]),
  )
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toEqual({ status: 'fresh', claims: { role: 'admin', storeId: 'store-9' } })
})

test("mot de passe changé depuis l'émission → stale", async () => {
  const db = makeDb(
    Promise.resolve([
      { passwordChangedAt: new Date('2026-06-02T08:00:00Z'), role: 'employee', storeId: null },
    ]),
  )
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toEqual({ status: 'stale' })
})

test('user disparu → stale', async () => {
  const db = makeDb(Promise.resolve([]))
  await expect(
    validatePasswordFreshness({ sub: 'gone', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toEqual({ status: 'stale' })
})

test('token sans sub → stale', async () => {
  const db = makeDb(Promise.resolve([]))
  await expect(
    validatePasswordFreshness({ passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toEqual({ status: 'stale' })
})

test('erreur DB → fresh SANS claims (fail-open) + erreur loggée', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const db = makeDb(Promise.reject(new Error('db down')))
  await expect(
    validatePasswordFreshness({ sub: 'u1', passwordChangedAt: NOW.getTime() }, db),
  ).resolves.toEqual({ status: 'fresh' })
  expect(consoleError).toHaveBeenCalled()
  consoleError.mockRestore()
})
