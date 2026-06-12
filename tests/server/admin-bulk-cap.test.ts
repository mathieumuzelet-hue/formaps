import { beforeEach, expect, test, vi } from 'vitest'

// Plomberie alignée sur admin-stores-conflict.test.ts : mocks de @/server/auth,
// @/server/db et du module password (argon2 natif — 200 vrais hash ralentiraient
// la suite ; hashPassword résout instantanément).
vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword, generatePassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generatePassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))
vi.mock('@/server/auth/generate-password', () => ({ generatePassword }))

// users.bulkCreate : un select stores (name→id) puis un insert par ligne.
const selectFrom = vi.fn()
const insertValues = vi.fn()
const dbMock = {
  select: vi.fn(() => ({ from: selectFrom })),
  insert: vi.fn(() => ({ values: insertValues })),
} as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

function caller() {
  return createCaller({
    session: {
      user: { id: 'admin1', role: 'admin', storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    email: `u${i}@aps.fr`,
    prenom: 'U',
    role: 'employee',
    magasin: '',
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  selectFrom.mockResolvedValue([])
  insertValues.mockResolvedValue(undefined)
  hashPassword.mockResolvedValue('$argon2id$dummy')
  generatePassword.mockReturnValue('Pass1234!')
})

test('rejette un bulkCreate users de 201 lignes (BAD_REQUEST zod)', async () => {
  await expect(caller().users.bulkCreate(makeRows(201))).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  })
})

test('accepte 200 lignes côté schéma (la mutation tourne)', async () => {
  const result = await caller().users.bulkCreate(makeRows(200))
  expect(result.created.length + result.errors.length).toBe(200)
})
