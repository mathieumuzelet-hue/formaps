import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { hashPassword, verifyPassword } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}))
vi.mock('@/server/auth/password', () => ({ hashPassword, verifyPassword }))

const selectLimit = vi.fn()
const updateWhere = vi.fn().mockResolvedValue(undefined)
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
  })),
  update: vi.fn(() => ({ set: updateSet })),
} as never

import { accountRouter } from '@/server/trpc/routers/account'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(accountRouter)

function caller() {
  return createCaller({
    session: {
      user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectLimit.mockResolvedValue([{ passwordHash: 'old-hash' }])
  verifyPassword.mockResolvedValue(true)
  hashPassword.mockResolvedValue('new-hash')
  updateWhere.mockResolvedValue(undefined)
})

test('mot de passe actuel incorrect → UNAUTHORIZED, aucun write', async () => {
  verifyPassword.mockResolvedValue(false)

  await expect(
    caller().changePassword({ currentPassword: 'wrong', newPassword: 'newpass123' }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  expect(updateSet).not.toHaveBeenCalled()
})

test('succès → hash mis à jour + passwordChangedAt posé', async () => {
  const result = await caller().changePassword({
    currentPassword: 'oldpass',
    newPassword: 'newpass123',
  })

  expect(result).toEqual({ ok: true })
  expect(hashPassword).toHaveBeenCalledWith('newpass123')
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({
      passwordHash: 'new-hash',
      passwordChangedAt: expect.any(Date),
    }),
  )
})

test('user introuvable en base → UNAUTHORIZED', async () => {
  selectLimit.mockResolvedValue([])
  await expect(
    caller().changePassword({ currentPassword: 'x', newPassword: 'newpass123' }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})
