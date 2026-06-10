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

const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))
const dbMock = { update: vi.fn(() => ({ set: updateSet })) } as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)

const USER_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

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
  hashPassword.mockResolvedValue('fresh-hash')
  generatePassword.mockReturnValue('Generated1234')
  updateReturning.mockResolvedValue([
    { id: USER_ID, email: 'u@b.fr', firstName: 'Léa', role: 'employee', storeId: null },
  ])
})

test('users.update AVEC password → hash + passwordChangedAt posés', async () => {
  await caller().users.update({ id: USER_ID, password: 'newpass123' })

  expect(hashPassword).toHaveBeenCalledWith('newpass123')
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'fresh-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('users.update SANS password → passwordChangedAt PAS touché', async () => {
  await caller().users.update({ id: USER_ID, firstName: 'Mia' })

  expect(hashPassword).not.toHaveBeenCalled()
  const setArg = updateSet.mock.calls[0][0]
  expect(setArg).not.toHaveProperty('passwordChangedAt')
  expect(setArg).not.toHaveProperty('passwordHash')
})

test('resetPassword → plaintext retourné une fois + hash + passwordChangedAt posés', async () => {
  const result = await caller().users.resetPassword({ id: USER_ID })

  expect(result).toEqual({ id: USER_ID, email: 'u@b.fr', password: 'Generated1234' })
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'fresh-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('resetPassword : user inconnu → NOT_FOUND', async () => {
  updateReturning.mockResolvedValue([])
  await expect(caller().users.resetPassword({ id: USER_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})
