import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword, generatePassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generatePassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))
vi.mock('@/server/auth/generate-password', () => ({ generatePassword }))

// --- update(...) chain mock ---
const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))

// --- select(...) chain mock ---
// Results are popped from a queue, one per `db.select()` call. The object
// returned by `.where()` is awaitable directly (count query) AND exposes
// `.limit()` (role-lookup query), matching both drizzle call shapes.
const selectQueue: unknown[][] = []
const selectWhere = vi.fn(() => {
  const result = selectQueue.shift() ?? []
  const promise = Promise.resolve(result)
  return Object.assign(promise, { limit: () => promise })
})
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbSelect = vi.fn(() => ({ from: selectFrom }))

const dbUpdate = vi.fn(() => ({ set: updateSet }))

const dbMock = {
  update: dbUpdate,
  select: dbSelect,
} as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

const ADMIN_1 = '11111111-1111-4111-8111-111111111111'
const ADMIN_2 = '22222222-2222-4222-8222-222222222222'
const EMP_1 = '33333333-3333-4333-8333-333333333333'

/** Caller authenticated as admin ADMIN_1. */
function caller() {
  return createCaller({
    session: {
      user: { id: ADMIN_1, role: 'admin', storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  hashPassword.mockResolvedValue('fresh-hash')
})

describe('admin.users.update — garde dernier admin', () => {
  it('refuse la rétrogradation de soi-même (FORBIDDEN)', async () => {
    await expect(
      caller().users.update({ id: ADMIN_1, role: 'employee' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(dbUpdate).not.toHaveBeenCalled()
  })

  it('refuse la rétrogradation du dernier admin (FORBIDDEN)', async () => {
    selectQueue.push([{ role: 'admin' }]) // role lookup of ADMIN_2
    selectQueue.push([{ n: 1 }]) // admin count = 1

    await expect(
      caller().users.update({ id: ADMIN_2, role: 'employee' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(dbSelect).toHaveBeenCalledTimes(2)
    expect(dbUpdate).not.toHaveBeenCalled()
  })

  it('autorise la rétrogradation quand il reste un autre admin', async () => {
    selectQueue.push([{ role: 'admin' }]) // role lookup of ADMIN_2
    selectQueue.push([{ n: 2 }]) // admin count = 2
    updateReturning.mockResolvedValue([
      { id: ADMIN_2, email: 'a2@b.fr', firstName: 'Deux', role: 'employee', storeId: null },
    ])

    const result = await caller().users.update({ id: ADMIN_2, role: 'employee' })
    expect(result).toMatchObject({ id: ADMIN_2 })
  })

  it("rétrograder un employé (no-op rôle) ne déclenche pas la garde count", async () => {
    selectQueue.push([{ role: 'employee' }]) // role lookup of EMP_1
    updateReturning.mockResolvedValue([
      { id: EMP_1, email: 'e1@b.fr', firstName: 'Emp', role: 'employee', storeId: null },
    ])

    const result = await caller().users.update({ id: EMP_1, role: 'employee' })
    expect(result).toMatchObject({ id: EMP_1 })
    // Only the role lookup ran — the admin-count query must NOT run.
    expect(dbSelect).toHaveBeenCalledTimes(1)
    expect(selectWhere).toHaveBeenCalledTimes(1)
  })

  it('un update sans champ role ne déclenche aucune requête de garde', async () => {
    updateReturning.mockResolvedValue([
      { id: ADMIN_2, email: 'a2@b.fr', firstName: 'Léa', role: 'admin', storeId: null },
    ])

    const result = await caller().users.update({ id: ADMIN_2, firstName: 'Léa' })
    expect(result).toMatchObject({ id: ADMIN_2 })
    // No guard queries at all.
    expect(dbSelect).not.toHaveBeenCalled()
    expect(selectWhere).not.toHaveBeenCalled()
  })

  it("une promotion vers admin n'est pas gardée (aucune requête de garde)", async () => {
    updateReturning.mockResolvedValue([
      { id: EMP_1, email: 'e1@b.fr', firstName: 'Emp', role: 'admin', storeId: null },
    ])

    const result = await caller().users.update({ id: EMP_1, role: 'admin' })
    expect(result).toMatchObject({ id: EMP_1, role: 'admin' })
    // Promotion path: no guard queries at all.
    expect(dbSelect).not.toHaveBeenCalled()
    expect(selectWhere).not.toHaveBeenCalled()
  })
})
