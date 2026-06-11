import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword, generatePassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generatePassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))
vi.mock('@/server/auth/generate-password', () => ({ generatePassword }))

const insertReturning = vi.fn()
const insertValues = vi.fn(() => ({ returning: insertReturning }))
const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbMock = {
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
} as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

const STORE_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

/** Postgres unique-violation error, shaped the way isUniqueViolation expects. */
function uniqueViolation() {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  })
}

function caller() {
  return createCaller({
    session: {
      user: { id: 'admin1', role: 'admin', storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('stores.create : nom déjà pris (23505) → CONFLICT « Nom de magasin déjà utilisé »', async () => {
  insertReturning.mockRejectedValue(uniqueViolation())

  await expect(
    caller().stores.create({ name: 'Auchan Tréville', basculeDate: '2026-07-01', currentStep: 0 }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nom de magasin déjà utilisé',
  })
})

test('stores.update : renommage vers un nom existant (23505) → CONFLICT', async () => {
  updateReturning.mockRejectedValue(uniqueViolation())

  await expect(
    caller().stores.update({ id: STORE_ID, name: 'Auchan Tréville' }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Nom de magasin déjà utilisé',
  })
})
